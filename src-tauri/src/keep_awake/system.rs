//! Adaptador del sistema: le pide al sistema operativo que no apague la pantalla (macOS: una
//! aserción de energía de IOKit, la misma de `caffeinate -d`; Windows: `SetThreadExecutionState`),
//! con la crate `keepawake`.
//!
//! En Windows esa petición pertenece al hilo que la hace y se suelta al terminar ese hilo o al
//! restablecerla desde él. Por eso cada petición vive en un hilo propio, que la crea y la suelta; en
//! macOS no hace falta, pero así los dos sistemas se comportan igual.

use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};

use super::{Hold, KeepAwakeError, ScreenKeeper};

pub struct SystemKeepAwake;

/// Una petición abierta: su hilo la sostiene hasta que este valor se suelta.
struct SystemHold {
    /// Al soltarse (o enviar algo), el hilo suelta la petición y termina.
    release: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Hold for SystemHold {}

impl Drop for SystemHold {
    fn drop(&mut self) {
        // Cerrar el canal despierta al hilo; esperar a que termine garantiza que ya se soltó.
        drop(self.release.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl ScreenKeeper for SystemKeepAwake {
    fn hold(&self) -> Result<Box<dyn Hold>, KeepAwakeError> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (release_tx, release_rx) = mpsc::channel::<()>();

        let thread = thread::Builder::new()
            .name("orbit-keep-awake".into())
            .spawn(move || {
                let created = keepawake::Builder::default()
                    .display(true)
                    .reason("Orbit keeps the screen on")
                    .app_name("Orbit")
                    .app_reverse_domain("dev.orbit.island")
                    .create();
                match created {
                    Ok(request) => {
                        let _ = ready_tx.send(Ok(()));
                        // Espera a que se suelte (el canal se cierra) y entonces la libera.
                        let _ = release_rx.recv();
                        drop(request);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                    }
                }
            })
            .map_err(|error| KeepAwakeError::System(error.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Box::new(SystemHold {
                release: Some(release_tx),
                thread: Some(thread),
            })),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(KeepAwakeError::System(message))
            }
            Err(_) => Err(KeepAwakeError::System(
                "el hilo terminó sin responder".into(),
            )),
        }
    }
}

#[cfg(test)]
#[cfg(target_os = "macos")]
mod tests {
    use std::process::Command;

    use super::*;

    /// Lo que macOS dice que tiene pedido (`pmset -g assertions`).
    fn assertions() -> String {
        let output = Command::new("pmset")
            .args(["-g", "assertions"])
            .output()
            .expect("pmset debe existir en macOS");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// Cuántas peticiones "no apagues la pantalla" de Orbit tiene el sistema ahora mismo.
    fn orbit_display_requests() -> usize {
        assertions()
            .lines()
            .filter(|line| line.contains("Orbit keeps the screen on"))
            .count()
    }

    /// Prueba con el sistema de verdad: pide mantener la pantalla encendida, comprueba con `pmset`
    /// que macOS lo registró y que al soltar la petición desaparece. Manual: toca la energía real.
    ///
    /// ```text
    /// cargo test live_the_system_registers_and_releases_the_request -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "pide una aserción de energía real a macOS"]
    fn live_the_system_registers_and_releases_the_request() {
        let before = orbit_display_requests();
        let hold = SystemKeepAwake
            .hold()
            .expect("macOS debe aceptar la petición");

        let during = assertions();
        println!("{during}");
        assert_eq!(orbit_display_requests(), before + 1);
        assert!(
            during.contains("PreventUserIdleDisplaySleep"),
            "debe ser de las que impiden apagar la pantalla"
        );

        drop(hold);
        assert_eq!(orbit_display_requests(), before, "al soltarla se libera");
    }
}
