import { ComponentLoader } from 'adminjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const componentLoader = new ComponentLoader();

// NODE_ENV can intentionally be set to "production" while running `tsx watch`
// against source files locally. Resolve based on which sibling component file
// actually exists instead of assuming NODE_ENV also tells us whether this is
// the compiled dist directory.
const componentExtension = existsSync(fileURLToPath(new URL('./components/dashboard.js', import.meta.url)))
  ? 'js'
  : 'tsx';

export const Components = {
  Dashboard: componentLoader.add(
    'Dashboard',
    `./components/dashboard.${componentExtension}`
  ),
  RedirectToManage: componentLoader.add(
    'RedirectToManage',
    `./components/redirect-to-manage.${componentExtension}`
  )
};
