// Vite and esbuild own runtime dependency bundling. The supervised package
// command verifies the guarded bundle identity before invoking this hook.
module.exports = async () => false;
