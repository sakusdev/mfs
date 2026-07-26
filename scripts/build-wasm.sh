#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain not found; installing minimal stable Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  export PATH="$HOME/.cargo/bin:$PATH"
fi

rustup target add wasm32-unknown-unknown

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack not found; installing prebuilt wasm-pack..."
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
  export PATH="$HOME/.cargo/bin:$PATH"
fi

wasm-pack build wasm/mfs-core \
  --target web \
  --out-dir ../../src/wasm/pkg \
  --release

wasm-pack build wasm/melody-core \
  --target web \
  --out-dir ../../src/wasm/melody-pkg \
  --release
