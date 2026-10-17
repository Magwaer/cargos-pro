#!/bin/sh
set -eu
/usr/local/bin/cert-sync.sh once
nohup /usr/local/bin/cert-sync.sh watch >/proc/1/fd/1 2>&1 &
