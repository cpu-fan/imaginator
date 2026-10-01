(function (root) {
  'use strict';
  const MAX_SOURCE_SIZE = 512 * 1024 * 1024;
  const MAX_PART_SIZE = 64 * 1024 * 1024;
  const MAX_PART_COUNT = 1000;
  function fail(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details) error.details = details;
    throw error;
  }
  function integer(value, min, max) {
    return Number.isSafeInteger(value) && value >= min && value <= max;
  }
  function parsePartSize(value, unit) {
    if (typeof value !== 'string' || !/^(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)$/.test(value.trim()) || !['KiB','MiB'].includes(unit)) {
      fail('INVALID_SPLIT', 'Введите положительный размер части в КиБ или МБ.');
    }
    const size = Math.floor(Number(value.trim().replace(',', '.')) * (unit === 'KiB' ? 1024 : 1048576));
    if (!integer(size, 1, MAX_PART_SIZE)) fail('INVALID_SPLIT', 'Размер части должен быть от 1 байта до 64 МБ.');
    return size;
  }
  function planParts(totalSize, options) {
    if (!integer(totalSize, 0, MAX_SOURCE_SIZE)) fail('INVALID_SPLIT', 'Размер исходного файла не должен превышать 512 МБ.');
    if (!options || !['single','count','size'].includes(options.mode)) fail('INVALID_SPLIT', 'Выберите способ разбивки.');
    let count;
    if (options.mode === 'size') {
      if (!integer(options.partSize, 1, MAX_PART_SIZE)) fail('INVALID_SPLIT', 'Размер части должен быть от 1 байта до 64 МБ.');
      count = Math.max(1, Math.ceil(totalSize / options.partSize));
    } else count = options.mode === 'single' ? 1 : options.count;
    if (!integer(count, 1, MAX_PART_COUNT)) fail('INVALID_SPLIT', 'Нужно от 1 до 1000 частей. Увеличьте размер части или уменьшите количество.');
    if ((totalSize === 0 && count !== 1) || (totalSize > 0 && count > totalSize)) fail('INVALID_SPLIT', 'Количество частей не может превышать число байтов файла. Для пустого файла нужна одна часть.');
    const q = Math.floor(totalSize / count), r = totalSize % count;
    const largest = options.mode === 'size' ? Math.min(totalSize, options.partSize) : q + (r ? 1 : 0);
    if (largest > MAX_PART_SIZE) fail('INVALID_SPLIT', 'В одной части не должно быть больше 64 МБ. Выберите разбивку или увеличьте количество частей.');
    return Array.from({length:count}, (_, index) => options.mode === 'size'
      ? {index,offset:index * options.partSize,length:Math.min(options.partSize, totalSize - index * options.partSize)}
      : {index,offset:index * q + Math.min(index,r),length:q + (index < r ? 1 : 0)});
  }
  function validatePart(info) {
    if (!info || typeof info.setId !== 'string' || !/^[0-9a-f]{32}$/.test(info.setId) || typeof info.name !== 'string' || typeof info.type !== 'string' ||
        !integer(info.count,1,MAX_PART_COUNT) || !integer(info.index,0,info.count-1) || !integer(info.totalSize,0,MAX_SOURCE_SIZE) ||
        !integer(info.offset,0,info.totalSize) || !integer(info.length,0,MAX_PART_SIZE) || info.offset + info.length > info.totalSize ||
        (info.totalSize === 0 ? info.count !== 1 || info.index !== 0 || info.offset !== 0 || info.length !== 0 : info.length === 0 || info.count > info.totalSize)) {
      fail('INVALID_PART', 'Некорректные сведения о части файла.');
    }
  }
  function validateSet(parts) {
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PART_COUNT) fail('INVALID_PART', 'Выберите от 1 до 1000 частей.');
    parts.forEach(validatePart);
    const first = parts[0], indexes = new Map();
    for (const part of parts) {
      if (['setId','name','type','count','totalSize'].some(field => part[field] !== first[field])) fail('MIXED_SETS', 'PNG относятся к разным наборам или содержат несовместимые сведения.');
      if (indexes.has(part.index)) fail('DUPLICATE_PART', 'Часть выбрана повторно.', {number:part.index+1});
      indexes.set(part.index,part);
    }
    const missing = Array.from({length:first.count}, (_, i) => i).filter(i=>!indexes.has(i));
    if (missing.length) fail('MISSING_PARTS', 'Не хватает частей.', {numbers:missing.map(i=>i+1)});
    const ordered = Array.from({length:first.count}, (_, i) => indexes.get(i));
    let offset = 0;
    for (const part of ordered) {
      if (part.offset !== offset) fail('INVALID_RANGES', 'Данные частей имеют пропуски или перекрытия.');
      offset += part.length;
    }
    if (offset !== first.totalSize) fail('INVALID_RANGES', 'Размер собранных данных не совпадает с исходным файлом.');
    return ordered;
  }
  const FileParts = {MAX_SOURCE_SIZE,MAX_PART_SIZE,MAX_PART_COUNT,parsePartSize,planParts,validatePart,validateSet};
  if (typeof module === 'object' && module.exports) module.exports = FileParts;
  else root.FileParts = FileParts;
})(globalThis);
