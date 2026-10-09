import '../developer-nav';
import './style.css';
import { createEditorSession } from './session';
const session = createEditorSession();
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
