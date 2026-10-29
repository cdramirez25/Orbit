//! Adaptador: la CPU, la memoria y la red del equipo con la crate `sysinfo` (macOS y Windows).

use sysinfo::{Networks, System};

use super::{Reading, SystemProbe};

/// Interfaces que no son la conexión real del equipo, por el comienzo de su nombre: la red entre
/// dispositivos de Apple (AirDrop, Sidecar), los puentes de las máquinas virtuales y las redes
/// virtuales de Windows. Contarlas sumaría dos veces el mismo tráfico o tráfico que no sale del
/// equipo.
const VIRTUAL_PREFIXES: [&str; 6] = ["awdl", "llw", "bridge", "anpi", "vEthernet", "Loopback"];

/// ¿El tráfico de esta interfaz cuenta como el de la red del equipo? `has_hardware_address` es falso en
/// las que no tienen dirección física: la interfaz local y los túneles de VPN (su tráfico ya se cuenta
/// en la conexión real, cifrado).
fn counts_as_traffic(name: &str, has_hardware_address: bool) -> bool {
    has_hardware_address
        && !VIRTUAL_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

pub struct SysinfoProbe {
    system: System,
    networks: Networks,
}

impl SysinfoProbe {
    pub fn new() -> Self {
        let mut system = System::new();
        // La CPU se mide entre dos lecturas: esta primera deja lista la siguiente.
        system.refresh_cpu_usage();
        system.refresh_memory();
        Self {
            system,
            networks: Networks::new_with_refreshed_list(),
        }
    }
}

impl Default for SysinfoProbe {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemProbe for SysinfoProbe {
    fn read(&mut self) -> Reading {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        // `true`: se olvidan las interfaces que ya no existen y salen las nuevas.
        self.networks.refresh(true);

        let (mut received_total, mut sent_total) = (0_u64, 0_u64);
        for (name, data) in &self.networks {
            let hardware = !data.mac_address().is_unspecified();
            if counts_as_traffic(name, hardware) {
                received_total = received_total.saturating_add(data.total_received());
                sent_total = sent_total.saturating_add(data.total_transmitted());
            }
        }

        Reading {
            cpu_percent: self.system.global_cpu_usage(),
            cpu_cores: self.system.cpus().len(),
            memory_used: self.system.used_memory(),
            memory_total: self.system.total_memory(),
            received_total,
            sent_total,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_real_connection_counts() {
        assert!(counts_as_traffic("en0", true));
        assert!(counts_as_traffic("Ethernet", true));
        assert!(counts_as_traffic("Wi-Fi", true));
    }

    #[test]
    fn interfaces_without_a_hardware_address_do_not_count() {
        assert!(!counts_as_traffic("lo0", false));
        assert!(!counts_as_traffic("utun3", false));
    }

    #[test]
    fn virtual_networks_do_not_count_even_with_an_address() {
        assert!(!counts_as_traffic("awdl0", true));
        assert!(!counts_as_traffic("llw0", true));
        assert!(!counts_as_traffic("bridge100", true));
        assert!(!counts_as_traffic("vEthernet (WSL)", true));
        assert!(!counts_as_traffic("Loopback Pseudo-Interface 1", true));
    }

    #[test]
    fn it_reads_something_sensible_from_this_computer() {
        let mut probe = SysinfoProbe::new();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let reading = probe.read();

        assert!((0.0..=100.0).contains(&reading.cpu_percent));
        assert!(reading.cpu_cores > 0);
        assert!(reading.memory_total > 0);
        assert!(reading.memory_used > 0 && reading.memory_used <= reading.memory_total);
    }

    #[test]
    fn the_network_counters_never_go_back_between_two_readings() {
        let mut probe = SysinfoProbe::new();
        let first = probe.read();
        let second = probe.read();

        assert!(second.received_total >= first.received_total);
        assert!(second.sent_total >= first.sent_total);
    }
}
