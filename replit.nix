{pkgs}: {
  deps = [
    pkgs.libgbm
    pkgs.expat
    pkgs.cairo
    pkgs.pango
    pkgs.xorg.libxcb
    pkgs.xorg.libX11
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXrandr
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.mesa
    pkgs.alsa-lib
    pkgs.at-spi2-core
    pkgs.libxkbcommon
    pkgs.dbus
    pkgs.libdrm
    pkgs.cups
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
