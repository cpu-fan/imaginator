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
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
    return `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ`;
  }

  function setStatus(form, message, isError = false) {
    const node = form.querySelector('.form-status');
    node.textContent = message;
    node.classList.toggle('is-error', isError);
  }

  function clearResult(form) {
    const oldUrl = downloadUrls.get(form);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    downloadUrls.delete(form);
    const result = form.querySelector('.result');
    result.hidden = true;
    const link = result.querySelector('.download-link');
    link.removeAttribute('href');
    link.removeAttribute('download');
  }

  function showResult(form, blob, name, detail) {
    clearResult(form);
    const url = URL.createObjectURL(blob);
    downloadUrls.set(form, url);
    const result = form.querySelector('.result');
    const link = result.querySelector('.download-link');
    link.href = url;
    link.download = name;
    const detailNode = result.querySelector('.result-detail');
    if (detailNode) detailNode.textContent = detail;
    result.hidden = false;
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('input, button').forEach((control) => { control.disabled = value; });
    document.querySelectorAll('.primary-button').forEach((button) => {
      button.setAttribute('aria-busy', String(value));
    });
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
    return { width, height, pixels: context.getImageData(0, 0, width, height).data };
  }

  function pngBlob(width, height, pixels) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Браузер не смог создать PNG.'));
        return;
      }
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      canvas.toBlob((blob) => {
        if (!blob || blob.type !== 'image/png') reject(new Error('Не удалось сохранить PNG. Попробуйте другой браузер.'));
        else resolve(blob);
      }, 'image/png');
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

  async function perform(mode) {
    const form = forms[mode];
    clearResult(form);
    try {
      if (mode === 'extract') {
        const file = selectedFile('extract-image', 'PNG');
        const password = passwordFor(mode);
        await assertPng(file);
        setStatus(form, 'Открываем PNG и проверяем пароль…');
        const image = await imagePixels(file, false);
        const decoded = ImageCodec.decode(image.pixels, image.width, image.height);
        const restored = await VaultCore.decryptFile(decoded.packet, password);
        const blob = new Blob([restored.bytes], { type: restored.type || 'application/octet-stream' });
        const name = restoredName(restored.name);
        showResult(form, blob, name, `${name} · ${formatSize(restored.bytes.length)}`);
        setStatus(form, 'Файл успешно восстановлен. Скачайте его ниже.');
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
      setStatus(form, friendlyError(error, mode), true);
    }
  }

  function availableApis() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(globalThis.crypto && crypto.subtle && crypto.getRandomValues && globalThis.File &&
        File.prototype.arrayBuffer && globalThis.Blob && globalThis.Image && globalThis.ImageData &&
        globalThis.URL && URL.createObjectURL && URL.revokeObjectURL && canvas.getContext &&
        canvas.getContext('2d') && canvas.toBlob && globalThis.VaultCore && globalThis.ImageCodec);
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
      info.textContent = file ? `${file.name} · ${formatSize(file.size)}` : '';
      if (input.id === 'hide-file' || input.id === 'hide-cover') updateCoverCapacity();
    });
  });
  document.querySelectorAll('input[type=password]').forEach((input) => {
    input.addEventListener('input', () => {
      clearResult(input.closest('form'));
      setStatus(input.closest('form'), '');
    });
  });
  modes.forEach((mode) => forms[mode].addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try { await perform(mode); }
    finally { setBusy(false); }
  }));

  if (!availableApis()) {
    document.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
    setStatus(forms.hide, 'Этот браузер не поддерживает необходимые функции: Web Crypto, File API или Canvas. Откройте страницу в современном браузере.', true);
  }
  window.addEventListener('beforeunload', () => downloadUrls.forEach((url) => URL.revokeObjectURL(url)));
})();
