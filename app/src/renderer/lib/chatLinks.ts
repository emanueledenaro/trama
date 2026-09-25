interface LinkProject {
  rootPath: string;
  snapshot: { modules: { files: { relativePath: string }[] }[] };
}

/**
 * The project file a link in the chat points to (W12): a path relative to the project or inside its folder,
 * with or without a line suffix such as `:12` or `#L12`. Null when the link names no file of the project.
 */
export function projectFileLink(href: string, project: LinkProject | null | undefined): string | null {
  if (!project) return null;
  let path: string;
  try {
    path = decodeURI(href);
  } catch {
    path = href;
  }
  path = path
    .replace(/^file:\/\//, "")
    .replace(/[#?].*$/, "")
    .replace(/:\d+(?::\d+)?$/, "");
  const root = project.rootPath.replace(/\/+$/, "");
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  path = path.replace(/^\.\//, "");
  if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return project.snapshot.modules.some((m) => m.files.some((f) => f.relativePath === path)) ? path : null;
}
