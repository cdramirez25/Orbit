# Uso: perl media.pl <ruta a liborbit_media.dylib> <función>
# Carga la biblioteca de `orbit_media.m` dentro de perl (el sistema solo deja usar MediaRemote a
# procesos de Apple) y llama a una de sus funciones: `orbit_media_watch` o `orbit_media_send`.
use strict;
use warnings;
use DynaLoader;

my ($library, $function) = @ARGV;
die "uso: media.pl <biblioteca> <función>\n" unless defined $library && defined $function;

my $handle = DynaLoader::dl_load_file($library, 0) or die "no se pudo cargar la biblioteca\n";
my $symbol = DynaLoader::dl_find_symbol($handle, $function) or die "falta la función $function\n";
DynaLoader::dl_install_xsub("main::$function", $symbol);

{
    no strict 'refs';
    &{"main::$function"}();
}
