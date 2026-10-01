(function () {
  'use strict';

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const modes = ['hide', 'data', 'extract'];
  const tabs = modes.map((mode) => document.getElementById(`tab-${mode}`));
  const forms = Object.fromEntries(modes.map((mode) => [mode, document.getElementById(`panel-${mode}`)]));
  const downloadUrls = new Map();
  let busy = false;
  let capacityRequest = 0;

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КиБ`;
    return `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МиБ`;
  }

  function setStatus(form, message, isError = false) {
    const node = form.querySelector('.form-status');
    node.textContent = message;
    node.classList.toggle('is-error', isError);
  }

  function clearResult(form) {
    for (const url of downloadUrls.get(form) || []) URL.revokeObjectURL(url);
    downloadUrls.delete(form);
    const result = form.querySelector('.result');
    result.hidden = true;
    const list = result.querySelector('.result-list');
    if (list) list.replaceChildren();
    result.querySelectorAll('.download-link').forEach(link => {
      link.removeAttribute('href'); link.removeAttribute('download');
    });
  }

  function showResult(form, blob, name, detail) {
    clearResult(form);
    const url = URL.createObjectURL(blob);
    downloadUrls.set(form, [url]);
    const result = form.querySelector('.result'), link = result.querySelector('.download-link');
    link.href = url; link.download = name;
    const detailNode = result.querySelector('.result-detail');
    if (detailNode) detailNode.textContent = detail;
    result.hidden = false;
  }

  function showResults(form, entries) {
    clearResult(form);
    const urls = [];
    downloadUrls.set(form, urls);
    const result = form.querySelector('.result'), list = result.querySelector('.result-list');
    try {
      for (const entry of entries) {
        const url = URL.createObjectURL(entry.blob); urls.push(url);
        const row = document.createElement('li'), info = document.createElement('div');
        info.className = 'result-file';
        const name = document.createElement('strong'), detail = document.createElement('p'), link = document.createElement('a');
        name.textContent = entry.name; detail.textContent = entry.detail;
        info.append(name, detail); link.className = 'download-link'; link.href = url; link.download = entry.name; link.textContent = 'Скачать PNG ↓';
        row.append(info, link); list.append(row);
      }
      result.hidden = false;
    } catch (error) { clearResult(form); throw error; }
  }

  function syncSplitFields() {
    const mode = document.getElementById('data-split-mode').value;
    document.getElementById('data-count-field').hidden = mode !== 'count';
    document.getElementById('data-size-field').hidden = mode !== 'size';
    document.getElementById('data-part-count').disabled = busy || mode !== 'count';
    document.getElementById('data-part-size').disabled = busy || mode !== 'size';
    document.getElementById('data-part-unit').disabled = busy || mode !== 'size';
  }

  function readSplitOptions() {
    const mode = document.getElementById('data-split-mode').value;
    if (mode === 'size') return { mode, partSize: FileParts.parsePartSize(document.getElementById('data-part-size').value, document.getElementById('data-part-unit').value) };
    if (mode === 'count') {
      const value = document.getElementById('data-part-count').value.trim();
      return {mode, count: /^[0-9]+$/.test(value) ? Number(value) : NaN};
    }
    return {mode};
  }

  function updateSplitPreview() {
    syncSplitFields();
    const node = document.getElementById('data-split-summary'), file = document.getElementById('data-file').files[0];
    node.classList.toggle('is-error', false);
    if (!file) { node.textContent = 'Выберите файл, чтобы увидеть расчёт частей.'; return; }
    try {
      const options = readSplitOptions(), parts = FileParts.planParts(file.size, options);
      const min = Math.min(...parts.map(p=>p.length)), max = Math.max(...parts.map(p=>p.length));
      const size = min === max ? formatSize(max) : `${formatSize(min)}–${formatSize(max)}`;
      node.textContent = `Частей: ${parts.length}. Исходные данные в части: ${size}.` + (options.mode === 'size' ? ` Последняя часть: ${formatSize(parts[parts.length - 1].length)}.` : '') + ' Готовые PNG будут больше.';
    } catch (error) { node.classList.toggle('is-error', true); node.textContent = friendlyError(error, 'data'); }
  }

  async function createDataPngs(file, password, options) {
    const parts = FileParts.planParts(file.size, options), session = await VaultCore.createEncryptSession(password);
    const entries = [], width = Math.max(3, String(parts.length).length);
    const stem = restoredName(file.name).replace(/\.[^.]+$/, '') || 'file';
    for (const part of parts) {
      setStatus(forms.data, `Создаём PNG: часть ${part.index + 1} из ${parts.length}…`);
      const bytes = new Uint8Array(await file.slice(part.offset, part.offset + part.length).arrayBuffer());
      const packet = await session.encryptPart({name:file.name,type:file.type,index:part.index,count:parts.length,totalSize:file.size,offset:part.offset,bytes});
      const image = ImageCodec.encodeData(packet), blob = await pngBlob(image.width, image.height, image.pixels);
      const name = options.mode === 'single' ? pngName(restoredName(file.name), 'данные') : `${stem}.part-${String(part.index + 1).padStart(width,'0')}-of-${String(parts.length).padStart(width,'0')}.png`;
      entries.push({blob,name,detail:formatSize(blob.size)});
    }
    return entries;
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('input, button, select').forEach((control) => { control.disabled = value; });
    document.querySelectorAll('.primary-button').forEach((button) => {
      button.setAttribute('aria-busy', String(value));
    });
    syncSplitFields();
  }

  function activateMode(mode, focus = false) {
    if (busy) return;
    modes.forEach((candidate, index) => {
      const selected = candidate === mode;
      tabs[index].setAttribute('aria-selected', String(selected));
      tabs[index].tabIndex = selected ? 0 : -1;
      forms[candidate].hidden = !selected;
      if (!selected) {
        clearResult(forms[candidate]);
        setStatus(forms[candidate], '');
      }
    });
    if (focus) document.getElementById(`tab-${mode}`).focus();
  }

  function selectedFile(inputId, label) {
    const file = document.getElementById(inputId).files[0];
    if (!file) throw new Error(`Выберите ${label}.`);
    return file;
  }

  function passwordFor(mode) {
    const password = document.getElementById(`${mode}-password`).value;
    if (!password.trim()) throw new Error('Введите пароль. Он не может состоять только из пробелов.');
    return password;
  }

  function checkSourceSize(file) {
    if (file.size > MAX_FILE_SIZE) throw new Error('Файл слишком большой. Максимальный размер — 10 МБ.');
  }

  function pngName(fileName, suffix) {
    const stem = fileName.replace(/\.[^.]+$/, '') || 'file';
    return `${stem}-${suffix}.png`;
  }

  function restoredName(name) {
    return name.split(/[\\/]/).pop() || 'восстановленный-файл';
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      let settled = false;
      function finish(error) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else resolve(image);
      }
      image.onload = () => finish();
      image.onerror = () => finish(new Error('Не удалось открыть изображение. Выберите исправный файл изображения.'));
      image.src = url;
    });
  }

  async function imagePixels(file, flatten) {
    const image = await loadImage(file);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 100000000) {
      throw new Error('Размеры изображения не поддерживаются. Выберите картинку меньшего размера.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Браузер не смог создать холст для изображения.');
    if (flatten) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0);
    try { return { width, height, pixels: context.getImageData(0, 0, width, height).data }; }
    finally { canvas.width = 1; canvas.height = 1; }
  }

  function pngBlob(width, height, pixels) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const release = () => { canvas.width = 1; canvas.height = 1; };
      canvas.width = width; canvas.height = height;
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Браузер не смог создать PNG.');
        context.putImageData(new ImageData(pixels, width, height), 0, 0);
        canvas.toBlob(blob => {
          release();
          if (!blob || blob.type !== 'image/png') reject(new Error('Не удалось сохранить PNG. Попробуйте другой браузер или уменьшите размер части.'));
          else resolve(blob);
        }, 'image/png');
      } catch (error) { release(); reject(error); }
    });
  }

  async function assertPng(file) {
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!PNG_SIGNATURE.every((byte, index) => signature[index] === byte)) {
      throw new Error('Выберите PNG, созданный этим приложением. JPEG и другие форматы не подходят.');
    }
  }

  function friendlyError(error, mode) {
    const message = error && error.message ? error.message : '';
    if (error && error.code === 'MISSING_PARTS') return `Не хватает частей: ${error.details.numbers.join(', ')}. Выберите полный набор PNG.`;
    if (error && error.code === 'DUPLICATE_PART') return `Часть ${error.details.number} выбрана повторно. Уберите её копию.`;
    if (/allocation|memory/i.test(message)) return 'Браузеру не хватило ресурсов. Уменьшите размер части или обрабатываемого файла и попробуйте снова.';
    if (message === 'Invalid image magic') return 'В этом PNG нет данных приложения. Выберите исходный PNG, полученный здесь.';
    if (message === 'Wrong password or corrupted file packet') return 'Неверный пароль или PNG повреждён. Проверьте пароль и загрузите исходный PNG.';
    if (/Malformed file packet|Unsupported file packet|Declared packet length|Image header exceeds capacity/.test(message)) return 'Данные в PNG повреждены или формат не поддерживается. Нужен исходный PNG без изменений.';
    if (/Packet exceeds cover capacity/.test(message)) return 'Изображение слишком маленькое для этого файла. Выберите носитель побольше.';
    if (/Packet exceeds image capacity|Invalid image dimensions/.test(message)) return 'Размер получившегося PNG не поддерживается. Попробуйте файл поменьше.';
    if (/File exceeds 10 MiB limit/.test(message)) return 'Файл слишком большой. Максимальный размер — 10 МБ.';
    if (/Web Crypto is unavailable/.test(message)) return 'В этом браузере недоступен Web Crypto. Откройте страницу в современном браузере.';
    if (/File name or MIME type is too long/.test(message)) return 'Имя файла или его тип слишком длинные. Переименуйте файл и попробуйте снова.';
    if (message) return message;
    return mode === 'extract' ? 'Не удалось извлечь файл из PNG.' : 'Не удалось создать PNG. Попробуйте ещё раз.';
  }

  async function updateCoverCapacity() {
    const request = ++capacityRequest;
    const file = document.getElementById('hide-cover').files[0];
    const source = document.getElementById('hide-file').files[0];
    const box = document.getElementById('capacity-box');
    const text = document.getElementById('capacity-text');
    box.classList.remove('is-error');
    if (!file) {
      text.textContent = 'Выберите изображение, чтобы узнать его вместимость.';
      return;
    }
    text.textContent = 'Проверяем размер изображения…';
    try {
      const image = await imagePixels(file, true);
      if (request !== capacityRequest) return;
      const capacity = ImageCodec.coverCapacity(image.width, image.height);
      let message = `Размер: ${image.width} × ${image.height} пикселей. Доступно для зашифрованного пакета: ${formatSize(capacity)}.`;
      if (source) {
        checkSourceSize(source);
        const needed = VaultCore.estimatePacketLength(source.size, source.name, source.type);
        message += ` Вашему файлу нужно ${formatSize(needed)}.`;
        if (needed > capacity) {
          message += ' Выберите картинку большего размера.';
          box.classList.add('is-error');
        } else {
          message += ' Файл поместится.';
        }
      }
      text.textContent = message;
    } catch (error) {
      if (request !== capacityRequest) return;
      box.classList.add('is-error');
      text.textContent = friendlyError(error, 'hide');
    }
  }

  async function restorePngFiles(files, password) {
    if (files.length < 1 || files.length > FileParts.MAX_PART_COUNT) throw new Error('Выберите от 1 до 1000 PNG: полный набор частей или один старый PNG.');
    const session = VaultCore.createDecryptSession(password), parts = [];
    let version, receivedSize = 0;
    for (let index = 0; index < files.length; index++) {
      setStatus(forms.extract, `Открываем PNG: ${index + 1} из ${files.length}…`);
      await assertPng(files[index]);
      const image = await imagePixels(files[index], false), decoded = ImageCodec.decode(image.pixels, image.width, image.height);
      const part = await session.decryptPacket(decoded.packet);
      if (version && version !== part.version) throw new Error('Нельзя смешивать старые PNG и части нового набора.');
      version = part.version;
      if (version === 1) {
        if (files.length !== 1) throw new Error('Для старого формата выберите один PNG. Несколько самостоятельных файлов нельзя собрать в набор.');
        return {name:restoredName(part.name),type:part.type,blob:new Blob([part.bytes],{type:part.type || 'application/octet-stream'})};
      }
      FileParts.validatePart(part);
      receivedSize += part.length;
      if (receivedSize > part.totalSize) {
        // Check identity/duplicates first so the actionable error wins.
        FileParts.validateSet([...parts, part]);
        throw new Error('Объём данных частей превышает размер исходного файла.');
      }
      parts.push(part);
      try { FileParts.validateSet(parts); }
      catch (error) { if (error.code !== 'MISSING_PARTS') throw error; }
    }
    const ordered = FileParts.validateSet(parts), first = ordered[0];
    return {name:restoredName(first.name),type:first.type,blob:new Blob(ordered.map(part=>part.bytes),{type:first.type || 'application/octet-stream'})};
  }

  async function perform(mode) {
    const form = forms[mode];
    clearResult(form);
    try {
      if (mode === 'extract') {
        const files = Array.from(document.getElementById('extract-image').files), password = passwordFor(mode);
        const restored = await restorePngFiles(files, password);
        showResult(form, restored.blob, restored.name, `${restored.name} · ${formatSize(restored.blob.size)}`);
        setStatus(form, 'Файл успешно восстановлен. Скачайте его ниже.');
        return;
      }

      if (mode === 'data') {
        const file = selectedFile('data-file', 'файл'), password = passwordFor(mode);
        const entries = await createDataPngs(file, password, readSplitOptions());
        showResults(form, entries);
        setStatus(form, `Готово PNG: ${entries.length}. Скачайте все части ниже.`);
        return;
      }

      const file = selectedFile(`${mode}-file`, 'файл');
      checkSourceSize(file);
      const password = passwordFor(mode);
      let cover;
      if (mode === 'hide') {
        const coverFile = selectedFile('hide-cover', 'изображение-носитель');
        setStatus(form, 'Открываем изображение и проверяем вместимость…');
        cover = await imagePixels(coverFile, true);
        const required = VaultCore.estimatePacketLength(file.size, file.name, file.type);
        if (required > ImageCodec.coverCapacity(cover.width, cover.height)) {
          throw new Error('Изображение слишком маленькое для этого файла. Выберите носитель побольше.');
        }
      }
      setStatus(form, 'Шифруем файл. Это может занять несколько секунд…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const packet = await VaultCore.encryptFile({ name: file.name, type: file.type, bytes }, password);
      const output = mode === 'hide'
        ? { width: cover.width, height: cover.height, pixels: ImageCodec.encodeStego(packet, cover.pixels, cover.width, cover.height) }
        : ImageCodec.encodeData(packet);
      setStatus(form, 'Сохраняем PNG…');
      const blob = await pngBlob(output.width, output.height, output.pixels);
      showResult(form, blob, pngName(file.name, mode === 'hide' ? 'скрыто' : 'данные'));
      setStatus(form, 'PNG готов. Скачайте картинку ниже.');
    } catch (error) {
      clearResult(form);
      setStatus(form, friendlyError(error, mode), true);
    }
  }

  function availableApis() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(globalThis.crypto && crypto.subtle && crypto.getRandomValues && globalThis.File &&
        File.prototype.arrayBuffer && globalThis.Blob && globalThis.Image && globalThis.ImageData &&
        globalThis.URL && URL.createObjectURL && URL.revokeObjectURL && canvas.getContext &&
        canvas.getContext('2d') && canvas.toBlob && globalThis.VaultCore && globalThis.ImageCodec && globalThis.FileParts);
    } catch {
      return false;
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateMode(modes[index]));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step) {
        event.preventDefault();
        activateMode(modes[(index + step + modes.length) % modes.length], true);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        activateMode(event.key === 'Home' ? modes[0] : modes[modes.length - 1], true);
      }
    });
  });

  document.querySelectorAll('.password-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.getAttribute('aria-controls'));
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      toggle.textContent = showing ? 'Скрыть' : 'Показать';
      toggle.setAttribute('aria-label', showing ? 'Скрыть пароль' : 'Показать пароль');
      input.focus();
    });
  });

  document.querySelectorAll('input[type=file]').forEach((input) => {
    input.addEventListener('change', () => {
      const form = input.closest('form');
      clearResult(form);
      setStatus(form, '');
      const info = document.getElementById(`${input.id}-info`);
      const file = input.files[0];
      info.textContent = input.id === 'extract-image' && input.files.length > 0
        ? `Выбрано PNG: ${input.files.length} · ${formatSize(Array.from(input.files).reduce((sum,item)=>sum+item.size,0))}`
        : file ? `${file.name} · ${formatSize(file.size)}` : '';
      if (input.id === 'data-file') updateSplitPreview();
      if (input.id === 'hide-file' || input.id === 'hide-cover') updateCoverCapacity();
    });
  });
  document.querySelectorAll('input[type=password]').forEach((input) => {
    input.addEventListener('input', () => {
      clearResult(input.closest('form'));
      setStatus(input.closest('form'), '');
    });
  });
  ['data-split-mode','data-part-count','data-part-size','data-part-unit'].forEach(id => {
    const input = document.getElementById(id);
    const event = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(event, () => { clearResult(forms.data); setStatus(forms.data, ''); updateSplitPreview(); });
  });
  updateSplitPreview();
  modes.forEach((mode) => forms[mode].addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try { await perform(mode); }
    finally { setBusy(false); }
  }));

  if (!availableApis()) {
    document.querySelectorAll('input, button, select').forEach((control) => { control.disabled = true; });
    setStatus(forms.hide, 'Этот браузер не поддерживает необходимые функции: Web Crypto, File API или Canvas. Откройте страницу в современном браузере.', true);
  }
  window.addEventListener('beforeunload', () => downloadUrls.forEach(urls => urls.forEach(url => URL.revokeObjectURL(url))));
})();
