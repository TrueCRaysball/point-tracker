fn main() {
    // Recompile when the build script stamps a new build number.
    println!("cargo:rerun-if-env-changed=PT_BUILD_NUMBER");
    tauri_build::build()
}
