#!/usr/bin/env sh
# certbot --nginx-ctl /opt/inkwell/src/deploy/nginx-checked.sh
# The nginx plugin reloads internally; enforce the same preflight as manual reloads.
set -eu
for arg in "$@"; do
  case "$arg" in
    -t|-T|-v|-V) exec /usr/sbin/nginx "$@" ;;
  esac
done
/usr/sbin/nginx -t
exec /usr/sbin/nginx "$@"
