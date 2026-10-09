import { openPreview } from './preview-session';
openPreview('/editor.html').catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
