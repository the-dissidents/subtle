#!/usr/bin/env bash
#
# logmem.sh – log RSS/VSZ for a process, a process‐group, or a list of PIDs
# on macOS, in CSV: timestamp,pid,rss_kb,vsz_kb

set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 [ -n NAME | -g PGID ] [ -i INTERVAL ] [ -o FILE ] [ pid... ]

  -n NAME       monitor all processes whose exact name is NAME (pgrep -x)
  -g PGID       monitor all processes in process‐group PGID
  pid...        explicit list of PIDs to monitor
  -i INTERVAL   sampling interval in seconds (default: 5)
  -o FILE       output CSV file (default: stdout)
  -h            this help

Examples:
  # log MyApp every 10s to myapp.csv
  $0 -n MyApp -i 10 -o myapp.csv

  # log PGID=12345 every 5s to stdout
  $0 -g 12345 -i 5

  # log PIDs 2345 and 6789 every 2s
  $0 2345 6789 -i 2
EOF
  exit 1
}

# defaults
interval=5
outfile=""
pname=""
pgid=""
declare -a pids=()

# parse flags and collect any non‐option args as PIDs
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n)
      pname=$2
      shift 2
      ;;
    -g)
      pgid=$2
      shift 2
      ;;
    -i)
      interval=$2
      shift 2
      ;;
    -o)
      outfile=$2
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      ;;
    *)
      pids+=("$1")
      shift
      ;;
  esac
done

# validate mode
if [[ -n $pname && -n $pgid ]]; then
  echo "Error: can't use both -n and -g" >&2
  usage
fi

if [[ -z $pname && -z $pgid && ${#pids[@]} -eq 0 ]]; then
  echo "Error: must supply -n, -g, or at least one PID" >&2
  usage
fi

# write header if logging to file
if [[ -n $outfile ]]; then
  printf 'timestamp,pid,rss_kb,vsz_kb\n' > "$outfile"
fi

trap 'echo; echo "Exiting."; exit 0' INT TERM

# main sampling loop
while true; do
  ts=$(date +'%Y-%m-%d %H:%M:%S')

  # refresh PID list if in name or pgid mode
  if [[ -n $pname ]]; then
    mapfile -t pids < <(pgrep -x "$pname")
  elif [[ -n $pgid ]]; then
    mapfile -t pids < <(
      ps -eo pid,pgid= |
        awk -v G=$pgid '$2==G { print $1 }'
    )
  fi

  # iterate over whatever PIDs we have
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      read -r rss vsz comm < <(ps -p "$pid" -o rss= -o vsz= -o comm=)
      line="$ts,$pid,$rss,$vsz"
    else
      line="$ts,$pid,EXITED"
    fi

    if [[ -n $outfile ]]; then
      echo "$line" >> "$outfile"
    else
      echo "$line"
    fi
  done

  sleep "$interval"
done