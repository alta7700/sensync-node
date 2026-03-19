#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

TS_PROTO_PLUGIN="$REPO_ROOT/node_modules/.bin/protoc-gen-ts_proto"
PLUGIN_KIT_PROTO_ROOT="$REPO_ROOT/packages/plugin-kit/src/ipc-worker/proto"
PLUGIN_KIT_PY_PROJECT="$REPO_ROOT/packages/plugin-kit/python-runtime"

if [ ! -f "$TS_PROTO_PLUGIN" ]; then
  echo "Не найден protoc-gen-ts_proto в node_modules. Сначала выполните npm install."
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

collect_proto_files() {
  local root_dir="$1"
  local result_var_name="$2"
  local proto_file=""
  eval "$result_var_name=()"
  # Собираем все .proto в root по соглашению, чтобы новый processor не требовал
  # правки списка файлов в самом генераторе.
  while IFS= read -r proto_file; do
    [ -n "$proto_file" ] || continue
    eval "$result_var_name+=(\"\$proto_file\")"
  done < <(find "$root_dir" -type f -name '*.proto' | sort)
}

collect_proto_files "$PLUGIN_KIT_PROTO_ROOT" SHARED_PROTO_FILES

if [ "${#SHARED_PROTO_FILES[@]}" -eq 0 ]; then
  echo "Не найдено ни одного shared .proto в $PLUGIN_KIT_PROTO_ROOT"
  exit 1
fi

copy_generated_tree() {
  local from_dir="$1"
  local to_dir="$2"

  mkdir -p "$to_dir"
  if [ -d "$from_dir" ]; then
    cp -R "$from_dir"/. "$to_dir"/
  fi
}

generate_typescript() {
  local out_dir="$1"
  shift
  local proto_paths=("$1")
  shift

  while [[ "$1" != "--" ]]; do
    proto_paths+=("$1")
    shift
  done
  shift

  local proto_files=("$@")
  protoc \
    --plugin="$TS_PROTO_PLUGIN" \
    --ts_proto_out="$out_dir" \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=outputServices=false \
    --ts_proto_opt=oneof=unions \
    --ts_proto_opt=useOptionals=messages \
    --ts_proto_opt=enumsAsLiterals=true \
    --ts_proto_opt=importSuffix=.ts \
    "${proto_paths[@]/#/--proto_path=}" \
    "${proto_files[@]}"
}

generate_python() {
  local out_dir="$1"
  shift
  local proto_paths=("$1")
  shift

  while [[ "$1" != "--" ]]; do
    proto_paths+=("$1")
    shift
  done
  shift

  local proto_files=("$@")
  uv run --project "$PLUGIN_KIT_PY_PROJECT" --with grpcio-tools python -m grpc_tools.protoc \
    "${proto_paths[@]/#/--proto_path=}" \
    --python_out="$out_dir" \
    "${proto_files[@]}"
}

generate_shared_proto_bundle() {
  local ts_temp="$TEMP_DIR/shared-ts"
  local ts_out="$REPO_ROOT/packages/plugin-kit/src/ipc-worker/generated"
  local py_out="$REPO_ROOT/packages/plugin-kit/python-runtime/src"

  mkdir -p "$ts_temp" "$ts_out" "$py_out"

  echo "=== Shared protobuf для plugin-kit/ipc-worker ==="
  generate_typescript "$ts_temp" "$PLUGIN_KIT_PROTO_ROOT" -- "${SHARED_PROTO_FILES[@]}"
  copy_generated_tree "$ts_temp" "$ts_out"
  generate_python "$py_out" "$PLUGIN_KIT_PROTO_ROOT" -- "${SHARED_PROTO_FILES[@]}"
}

generate_package_proto_bundle() {
  local proto_root="$1"
  local package_dir
  package_dir="$(dirname "$proto_root")"
  local package_name
  package_name="$(basename "$package_dir")"
  local ts_temp="$TEMP_DIR/$package_name-ts"
  local ts_out="$package_dir/src/generated"
  local py_out="$package_dir/python_worker/generated"
  local local_proto_files=()

  collect_proto_files "$proto_root" local_proto_files
  if [ "${#local_proto_files[@]}" -eq 0 ]; then
    return
  fi

  mkdir -p "$ts_temp" "$ts_out"

  echo "=== Local protobuf для $package_name ==="
  generate_typescript "$ts_temp" "$PLUGIN_KIT_PROTO_ROOT" "$proto_root" -- "${SHARED_PROTO_FILES[@]}" "${local_proto_files[@]}"
  copy_generated_tree "$ts_temp" "$ts_out"

  if [ -d "$package_dir/python_worker" ]; then
    mkdir -p "$py_out"
    generate_python "$py_out" "$PLUGIN_KIT_PROTO_ROOT" "$proto_root" -- "${SHARED_PROTO_FILES[@]}" "${local_proto_files[@]}"
  fi
}

generate_shared_proto_bundle

# Любой workspace-пакет с папкой proto автоматически считается участником codegen.
PACKAGE_PROTO_ROOTS=()
while IFS= read -r proto_root; do
  PACKAGE_PROTO_ROOTS+=("$proto_root")
done < <(find "$REPO_ROOT/packages" -type d -path '*/proto' ! -path "$PLUGIN_KIT_PROTO_ROOT" | sort)

for proto_root in "${PACKAGE_PROTO_ROOTS[@]}"; do
  generate_package_proto_bundle "$proto_root"
done

echo "Готово."
