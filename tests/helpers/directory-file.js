function directoryFile(path, contents, options = {}) {
  const file = new File([contents], path.split('/').pop(), {lastModified: Date.UTC(2026, 0, 2), ...options});
  Object.defineProperty(file, 'webkitRelativePath', {value: path});
  return file;
}
module.exports = {directoryFile};
