# Multipart PNG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить создание набора PNG из большого файла с выбором числа или размера частей и восстановление исходного файла из полного набора.

**Architecture:** `file-parts.js` рассчитывает диапазоны и проверяет набор; `vault-core.js` шифрует и расшифровывает FVLT v2 с сохранением API v1. `app.js` последовательно читает части, работает с существующим кодеком и Canvas, управляет прогрессом и ссылками. Шаблон и скрипт сборки создают один автономный `index.html`.

**Tech Stack:** JavaScript, HTML, CSS, Web Crypto, File/Blob API, Canvas; Node.js и встроенные `node:test`, `node:assert/strict`, `node:vm`, `node:crypto`. Без новых зависимостей.

**Spec:** [Согласованная спецификация](/Users/Azat/dev/sendler/docs/superpowers/specs/2026-09-30-multipart-png-design.md).

## Global Constraints

- Разбивка применяется только к режиму «Создать PNG с данными».
- Стартовые защитные пределы: исходный файл до 512 МиБ включительно, данные одной части до 64 МиБ включительно, до 1000 частей включительно.
- В байтах это 536870912 и 67108864; 1 КиБ = 1024 байта, 1 МиБ = 1048576 байт.
- Выбранный размер относится к исходным данным; готовый PNG может быть больше. Точка и запятая допустимы; дробный размер округляется вниз до целого байта.
- По числу частей: первые S mod N частей на один байт больше остальных; пустые части непустого файла запрещены. Пустой файл — одна часть.
- Результат — список отдельных PNG со ссылкой на каждый, без ZIP.
- FVLT v2: внешний заголовок 37 байт, зашифрованный заголовок 40 байт, big-endian; точная раскладка полей — в спецификации.
- PBKDF2 SHA-256, 310000 итераций, соль 16 байт на набор, AES-GCM 256, уникальный случайный IV 12 байт на часть, тег 16 байт. Заголовок v2 целиком передаётся как AAD.
- Все новые автоматически создаваемые PNG используют v2, включая одиночные. Старое приложение их не читает; новое читает v1 и v2.
- Режим скрытия сохраняет v1 и предел 10 МиБ. RGB-контейнер и ограничения размеров `image-codec.js` сохраняются.
- Для восстановления нужен полный набор; порядок выбора и имена PNG не определяют порядок сборки. Нельзя смешивать наборы, версии или несколько самостоятельных v1.
- Приложение остаётся локальным автономным `index.html`, без сервера, внешних библиотек и постоянного хранения данных.
- При смене входов, новой операции, ошибке и закрытии страницы удалять результаты и отзывать их Object URL. Неполный результат не публиковать.
- Пределы не гарантируют достаточную память каждого устройства. Готовые PNG и расшифрованные части накапливаются в памяти; итоговый Blob собирается из частей без дополнительного общего Uint8Array.

## Review Focus

- Смена единиц, способа разбивки или пароля после получения PNG должна отзывать все старые ссылки, а не только первую: тесты Task 3.
- Ошибка Canvas или создания Object URL после первой успешной части не должна оставлять частичный набор или блокировать следующую попытку: тесты Task 3.
- Имя исходного файла с HTML-разметкой должно отображаться текстом; компоненты пути в восстановленном имени должны удаляться: тесты Task 3 и Task 4.
- Два набора с одинаковыми именем, размером и даже солью должны различаться по защищённому идентификатору: тесты Task 1 и Task 4.
- Повреждение v2, Unicode-метаданные и поля длины нельзя проверять только собственным циклом encrypt/decrypt: независимые записи через `node:crypto`, Task 2.

## Файлы и подготовка к выполнению

Новые файлы: `file-parts.js`, `tests/file-parts.test.js`, `tests/vault-parts.test.js`, `tests/helpers/v2-packet-fixture.js`, `tests/helpers/app-harness.js`, `tests/app-parts.test.js`, `docs/superpowers/verification/2026-09-30-multipart-png.md`.

Изменяемые файлы: `vault-core.js`, `app.js`, `index.template.html`, `styles.css`, `scripts/build-standalone.js`, `tests/standalone-html.test.js`, `README.md`; `index.html` только пересобирается. `image-codec.js` и существующие тесты v1 изменять лишь при подтверждённой необходимости, не ослабляя их проверки.

Перед выполнением прочитать спецификацию и применить навык из заголовка плана. Изоляцию выбрать через `using-git-worktrees` с учётом текущего рабочего дерева. Сейчас в нём есть несохранённые изменения `README.md`, `index.html` и новые исходники автономной сборки, на которые опирается план: `index.template.html`, `scripts/build-standalone.js`, `tests/standalone-html.test.js`. Обычный worktree от HEAD их не содержит. Не сбрасывать их и не начинать реализацию в checkout без этих исходников; переносить нужные текущие файлы в изоляцию с сохранением исходного рабочего дерева.

В начале выполнения запустить `node --test tests/*.test.js` и записать исходный результат. Этот набор включает тест, пересобирающий `index.html`; запускать его в подготовленной изоляции. Коммиты каждого этапа включают только его файлы, не посторонние изменения и не `.DS_Store`.

---

### Task 1: Расчёт частей, проверка набора и подключение модуля

**Files:** Create `file-parts.js`, `tests/file-parts.test.js`; modify `index.template.html` (scripts), `scripts/build-standalone.js`, `tests/standalone-html.test.js`; rebuild `index.html`.

**Interfaces:**

- `FileParts.MAX_SOURCE_SIZE = 536870912`, `MAX_PART_SIZE = 67108864`, `MAX_PART_COUNT = 1000`.
- `parsePartSize(value: string, unit: 'KiB'|'MiB') -> number` — строгий десятичный ввод с точкой или запятой, без экспоненты и разделителей тысяч; допустимы окружающие пробелы. Возвращает целые байты в пределах части.
- `planParts(totalSize: number, options: {mode:'single'} | {mode:'count',count:number} | {mode:'size',partSize:number}) -> {index:number,offset:number,length:number}[]`.
- `PartInfo = {setId:string,name:string,type:string,index:number,count:number,totalSize:number,offset:number,length:number}`; `setId` — 32 символа lowercase hex, кодирующие 16 байт.
- `validatePart(info: PartInfo) -> void`; `validateSet(parts: PartInfo[]) -> PartInfo[]`, возвращает новый массив ссылок на записи в порядке индекса, без сортировки входного массива на месте. Дополнительное поле `bytes` сохраняется.
- Ошибки проверок — `Error` с `code`: `INVALID_SPLIT`, `INVALID_PART`, `MISSING_PARTS`, `DUPLICATE_PART`, `MIXED_SETS`, `INVALID_RANGES`. Для пропусков `details.numbers` содержит номера от 1, для повтора `details.number` — номер от 1. UI использует код, а не регулярные выражения по тексту.
- Экспорт CommonJS для Node и `globalThis.FileParts` для браузера. Порядок scripts: `file-parts.js`, `vault-core.js`, `image-codec.js`, `app.js`.

- [ ] **Step 1: Добавить проверки расчётов** в `tests/file-parts.test.js`; каждая строка ниже — отдельный именованный тест. `MiB = 1048576`.

```js
// count balances the 37 MiB example
assert.deepEqual(FileParts.planParts(37 * MiB, {mode:'count', count:4}).map(p => p.length), Array(4).fill(37 * MiB / 4));
// size permits parts larger than the old 10 MiB limit
assert.deepEqual(FileParts.planParts(37 * MiB, {mode:'size', partSize:20 * MiB}).map(p => [p.offset,p.length]), [[0,20 * MiB],[20 * MiB,17 * MiB]]);
// count distributes remainder at the beginning
assert.deepEqual(FileParts.planParts(7, {mode:'count', count:3}).map(p => [p.offset,p.length]), [[0,3],[3,2],[5,2]]);
// decimal parsing accepts both separators and floors bytes
assert.equal(FileParts.parsePartSize('2,5','MiB'), 2621440);
assert.equal(FileParts.parsePartSize('2.5','MiB'), 2621440);
assert.equal(FileParts.parsePartSize('0.001','KiB'), 1);
// empty files have exactly one zero-length part
assert.deepEqual(FileParts.planParts(0,{mode:'single'}), [{index:0,offset:0,length:0}]);
```

Добавить табличные assertions для `single` на 64 МиБ, `count` на 512 МиБ/8 частей, ровно 1000 частей, размера больше файла, пустого файла в `count` и `size`. `assert.throws` для каждого превышения, нецелого или небезопасного числа, N > S, нуля, отрицательного значения, пустого ввода, `NaN`, `Infinity`, экспоненты, неизвестного режима/единицы и размера меньше байта. Проверять размеры математически, не выделять массивы на 512 МиБ.

- [ ] **Step 2: Добавить проверки набора.** Использовать две записи с одинаковыми setId/name/type/count=2/totalSize=7 и диапазонами [0,3], [3,4]. `assert.deepEqual(validateSet([second,first]), [first,second])`; исходный порядок не изменился. Для одного пропуска проверять `error.code === 'MISSING_PARTS'` и `error.details.numbers` равен `[2]`; для повтора — `DUPLICATE_PART` и номер 1. Таблично отклонять иной setId при совпадающих прочих полях, несовпадение имени/типа/count/totalSize, разрыв, перекрытие, неверный index/setId, превышенные пределы, пустую часть непустого файла и несоответствие суммы длин. Отдельно принять одну пустую запись с totalSize=0.
- [ ] **Step 3: Запустить** `node --test tests/file-parts.test.js`; ожидать FAIL из-за отсутствующего модуля/API.
- [ ] **Step 4: Реализовать интерфейсы** в `file-parts.js`. Проверять числа до арифметики, не исправлять параметры автоматически; использовать формулы спецификации. Проверять метаданные каждой записи до индексации и проверки полноты.
- [ ] **Step 5: Подключить модуль в переносимую сборку.** Добавить script в шаблон и build; в существующем тесте ожидать четыре script и выполнять первые три в правильном порядке. Старый цикл v1 сохранить. Выполнить `node scripts/build-standalone.js`.
- [ ] **Step 6: Запустить** `node --test tests/*.test.js`; ожидать все PASS. Проверить `git diff --check` и коммит файлов этапа с сообщением `feat: add file part planning and validation`.

### Task 2: Шифрование и чтение FVLT v2 с независимой проверкой формата

**Files:** Modify `vault-core.js`; create `tests/vault-parts.test.js`, `tests/helpers/v2-packet-fixture.js`; rebuild `index.html`.

**Interfaces:**

- Consumes `FileParts.validatePart` и пределы Task 1; браузерная зависимость уже подключена.
- Сохранить `estimatePacketLength`, `encryptFile`, `decryptFile` и их результаты v1 без изменения формы объектов.
- `VaultCore.createEncryptSession(password: string) -> Promise<{encryptPart(input: {name,type,index,count,totalSize,offset,bytes:Uint8Array}) -> Promise<Uint8Array>}>`. Сессия владеет ключом, солью, setId и множеством использованных IV; самостоятельно добавляет setId и length. Пароль не входит в возвращаемый объект.
- `VaultCore.createDecryptSession(password: string) -> {decryptPacket(packet:Uint8Array) -> Promise<Decoded>}`. Кэш ключей по соли принадлежит только этой сессии.
- `Decoded = {version:1,name,type,bytes:Uint8Array} | ({version:2,bytes:Uint8Array} & PartInfo)`. Это отдельный API; `decryptFile` остаётся API v1.
- Test helper `makeV2Packet(info: PartInfo, bytes: Uint8Array, overrides?: {nameBytes?:Uint8Array,typeBytes?:Uint8Array}) -> Uint8Array`: независимая запись формата через Buffer, `pbkdf2Sync`, `createCipheriv`, AAD и тег. Фиксированные тестовые пароль/соль/IV; неправильные метаданные намеренно допустимы только внутри helper.

- [ ] **Step 1: Написать независимый fixture helper и тест чтения.** Фиксировать setId `000102030405060708090a0b0c0d0e0f`, пароль `interop`, имя `猫.bin`, type `application/octet-stream`, данные `[0,42,255]`, index=0/count=1/totalSize=3/offset=0/length=3. Assert: `decryptPacket` возвращает version=2, все поля PartInfo и те же байты. Это проверяет раскладку, UTF-8 и AAD независимо от нового encryptPart.
- [ ] **Step 2: Написать тесты создания и отказов.** Assert для нового пакета: первые пять байт `[70,86,76,84,2]`, длина в offset 5 равна `packet.length-37`, длина пакета `37+40+new TextEncoder().encode(name).length+new TextEncoder().encode(type).length+bytes.length+16`. Две части одной сессии имеют одинаковую соль, различные IV и setId после расшифрования; отдельная сессия имеет другой setId. Добавить цикл для одной части размером 11 МиБ, пустого файла и Unicode-имени; сохранить fixture v1 и тест отказа v1 >10 МиБ.
- [ ] **Step 3: Добавить отрицательные assertions.** `assert.rejects` для пустого пароля, неправильного пароля, изменения внешнего заголовка или шифротекста, усечения, неподдерживаемой версии, несовпадающей длины, некорректного UTF-8 и независимо зашифрованных невалидных метаданных: index=count, count=0/1001, totalSize>512 МиБ, offset+length>totalSize, пустая часть непустого файла, несоответствие length фактическим данным. Граничные значения метаданных проверять без огромных payload. Отдельный тест пакета длиной `37+40+65535+65535+67108864+16+1` с согласованной внешней длиной должен отклонить его до вызова deriveKey/decrypt; один такой массив допустим для этой проверки.
- [ ] **Step 4: Проверить сессионные гарантии в browser-VM.** В отдельном VM загрузить FileParts/VaultCore с обёрткой реального Web Crypto: счётчик `deriveKey` должен равняться 1 при двух encryptPart и 1 при двух decryptPacket с общей солью. Подменить только `getRandomValues` для 12-байтового IV: сначала повторить предыдущий IV, затем выдать новый; assert, что возвращённые пакеты имеют разные IV. Полную криптографию не заменять заглушкой.
- [ ] **Step 5: Запустить** `node --test tests/vault-core.test.js tests/vault-parts.test.js`; v1 ожидаемо PASS, новые тесты FAIL из-за отсутствующих API.
- [ ] **Step 6: Реализовать API** в `vault-core.js`, оставив логику v1. Для v2 сначала проверять пакет и его предел `37+40+65535+65535+67108864+16`, затем расшифровывать с AAD. Использовать `validatePart` до шифрования и после чтения; проверять bytes.length отдельно. В сообщении ошибки аутентификации сохранить `Wrong password or corrupted file packet`. Повторно использовать только локальный ключ для совпадающей соли.
- [ ] **Step 7: Пересобрать HTML и запустить** `node --test tests/*.test.js`; ожидать все PASS. Проверить diff и коммит `feat: add authenticated multipart vault packets`.

### Task 3: Создание набора PNG, параметры и жизненный цикл ссылок

**Files:** Modify `app.js` (результаты, busy, data flow, обработчики), `index.template.html` (panel-data), `styles.css`; create `tests/helpers/app-harness.js`, `tests/app-parts.test.js`; rebuild `index.html`.

**Interfaces:**

- Consumes `FileParts.planParts`, `parsePartSize`, `VaultCore.createEncryptSession`, существующие `ImageCodec.encodeData`, `pngBlob`.
- Controls: `data-split-mode` select (`single` default, `count`, `size`); `data-part-count` input (default 4); `data-part-size` text input с `inputmode="decimal"` (default 10); `data-part-unit` select (`KiB`, default `MiB`); `data-split-summary` live-region; `data-results` list. Показывать только параметры выбранного способа.
- Внутренние функции `readSplitOptions() -> options`, `updateSplitPreview() -> void`, `createDataPngs(file,password,options) -> Promise<{blob:Blob,name:string,detail:string}[]>`, `showResults(form,entries) -> void`. Существующий `showResult` сохраняет одиночное отображение для hide/extract.
- `downloadUrls` хранит массив URL для каждой формы; `clearResult(form)` отзывает все URL и очищает соответствующий результат. Обработчики input/change очищают результат до обновления предпросмотра.
- Test harness `createAppHarness(overrides={})` запускает реальный `app.js` в VM с узлами его интерфейса и заглушками Image/Canvas/URL. Возвращает `setFiles(id,files)`, `setValue(id,value,eventType='input')`, `submit(mode):Promise<void>`, `dispatch(id,eventType):Promise<void>`, `entries(mode):{name,blob}[]`, `status(mode):string`, `hasResult(mode):boolean`, `controlsDisabled():boolean`, `unload():void`, `activeUrls:Map`, `revokedUrls:Set`. Заглушки предназначены для поведения формы, реальные PNG проверяются в Task 5.

- [ ] **Step 1: Создать harness и тесты через события формы.** Assert default single и скрытые альтернативные поля; 37 МиБ/count=4 даёт четыре диапазона по 9,25 МиБ в summary; size=`20`/MiB даёт две части 20 и 17 МиБ; смена единиц и запятая меняют расчёт; неверные параметры показывают ошибку без вызова шифрования. Для файлов использовать `File`/Blob либо маленький fake File с size и отслеживаемым slice, без массива 37 МиБ в UI-тесте.
- [ ] **Step 2: Добавить assertions создания.** Передать fake File размером 7 байт, count=3; ожидаемые slice `[0,3]`, `[3,5]`, `[5,7]`, чтение исходного `file.arrayBuffer()` запрещено заглушкой. Assert `createEncryptSession` вызывается один раз, одновременно обрабатывается не больше одной части, список появляется после третьей PNG, имена `sample.part-001-of-003.png` … `003`, размеры соответствуют Blob. Для single сохранить `sample-данные.png`; для файла 1000 байт/count=1000 со stub Canvas проверить имена `sample.part-0001-of-1000.png` и `sample.part-1000-of-1000.png`, затем очистить результаты. Этот тест не создаёт настоящие PNG.
- [ ] **Step 3: Добавить assertions жизненного цикла.** После трёх готовых ссылок каждое из событий file/password/mode/count/size/unit и переключение вкладки отзывает все три URL и убирает результат. Ошибка toBlob на второй части, возврат null, исключение createObjectURL на второй ссылке и ошибка Blob не оставляют активных ссылок или видимого неполного набора; `controlsDisabled()` становится false, следующая попытка успешна. Пока операция не закончена, input/button/select заблокированы и повторный submit не запускает вторую сессию. При unload все ссылки отозваны. Имя `<img onerror=...>.bin` отображается через textContent, без создания HTML-элемента из имени.
- [ ] **Step 4: Запустить** `node --test tests/app-parts.test.js`; ожидать FAIL на новых полях/поведении. Harness не должен экспортировать внутренние функции app или повторять его алгоритм: проверять доступные пользователю события и результаты.
- [ ] **Step 5: Реализовать controls, preview и создание.** В data flow заменить чтение всего файла на последовательный цикл slice, session.encryptPart, encodeData, pngBlob. Результаты публиковать атомарно после всего набора; showResults должен отзывать уже созданные URL при сбое рендера. Сбрасывать временные Canvas после завершения чтения/создания PNG, учитывая асинхронный toBlob. В busy и проверке API учитывать select и FileParts; не разрешать неактивные поля при выходе из busy. Сохранить существующие hide/extract до Task 4.
- [ ] **Step 6: Обновить копирайт и стили panel-data.** Указать 512 МиБ исходного файла, 64 МиБ данных на PNG, размер PNG отдельно, необходимость всех частей; адаптивный список, labels, keyboard и live-region. Общий footer больше не объявляет универсальный предел 10 МБ; предел скрытия остаётся явно указанным в его форме.
- [ ] **Step 7: Пересобрать HTML и запустить** `node --test tests/*.test.js`; ожидать все PASS. Проверить diff и коммит `feat: create downloadable PNG file parts`.

### Task 4: Восстановление полного набора и сообщения об ошибках

**Files:** Modify `app.js` (extract flow, ошибки, сведения о выборе), `index.template.html` (panel-extract), `tests/app-parts.test.js`; rebuild `index.html`.

**Interfaces:**

- Consumes `VaultCore.createDecryptSession`, `FileParts.validateSet`, existing `assertPng`, `imagePixels`, `ImageCodec.decode`, `restoredName`, `showResult`.
- `restorePngFiles(files: File[], password:string) -> Promise<{name:string,type:string,blob:Blob}>` — внутренний обработчик, последовательная обработка без изменения порядка files; Blob состоит из упорядоченных bytes.
- `extract-image` получает multiple; сведения о выборе показывают число файлов и суммарный размер, а не только первое имя. До декодирования требуется от 1 до 1000 файлов.
- v1: ровно один выбранный пакет, существующее извлечение. v2: metadata каждого пакета проверяется сразу; set проверяется до создания итогового Blob. Смешение версий и нескольких v1 отклоняется.

- [ ] **Step 1: Добавить assertions успешной сборки.** В harness передать три PNG с защищёнными диапазонами и байтами `[0,255]`, `[42]`, `[7,8]` в порядке 3/1/2 и с произвольными именами. Assert одна ссылка на `original.bin`, Blob type совпадает с исходным, `await blob.arrayBuffer()` даёт `[0,255,42,7,8]`; исходный порядок files сохранён. Проверить одну часть v2, пустой файл, одиночный v1 и восстановленное имя `../folder\\safe.bin` → `safe.bin`.
- [ ] **Step 2: Добавить assertions отказов.** Для пропусков 2 и 4 status содержит оба номера; для повтора — номер повторной части. Два набора с одинаковыми солью/именем/размером, но разными setId, смешение v1/v2, два v1, разрывы/перекрытия, неверный пароль, повреждённый пакет и не-PNG не дают download. Проверка массива больше 1000 файлов срабатывает до вызова decode. После любого отказа следующая корректная попытка работает; промежуточные данные не отображаются.
- [ ] **Step 3: Запустить** `node --test tests/app-parts.test.js`; ожидать FAIL только для нового сценария extraction.
- [ ] **Step 4: Реализовать restorePngFiles и форму.** Создавать одну decrypt-session на попытку; при расшифровании показывать прогресс, сразу отклонять неправильные метаданные и несовместимые версии. После validateSet собрать `new Blob(ordered.map(part=>part.bytes), {type:ordered[0].type || 'application/octet-stream'})`; не выделять общий Uint8Array. `friendlyError` переводит коды FileParts в понятные сообщения, сообщение неверного пароля/повреждения остаётся объединённым. При ошибке очистить весь результат, затем показать status.
- [ ] **Step 5: Обновить подсказки panel-extract.** Выбирать полный набор в одной операции или один прежний PNG; порядок не важен, оригинальные PNG нельзя изменять. Сведения о нескольких файлах и aria-describedby должны соответствовать форме.
- [ ] **Step 6: Пересобрать HTML и запустить** `node --test tests/*.test.js`; ожидать все PASS. Проверить diff и коммит `feat: restore files from complete PNG sets`.

### Task 5: Автономный HTML, реальные PNG и проверка ресурсов

**Files:** Modify `tests/standalone-html.test.js`, `README.md`; create `docs/superpowers/verification/2026-09-30-multipart-png.md`; rebuild `index.html`.

**Interfaces:**

- Consumes завершённые модули и UI Tasks 1–4.
- Produces переносимый `index.html`, инструкцию по новым режимам и запись результатов проверки с браузером, версией, устройством, размерами, сравнением байтов и ограничениями среды.

- [ ] **Step 1: Дополнить автономный тест.** Четыре встроенных script, нет внешних script src/stylesheet. В VM выполнить первые три; разбить `[0,255,42,7,8]` на три части, зашифровать одной сессией, пропустить каждую через настоящие encodeData/decode, расшифровать в обратном порядке, validateSet и Blob. Assert исходное имя/type и точные байты; отдельно сохранить цикл v1. Выполнить `node --test tests/standalone-html.test.js`, ожидать PASS; если тест обнаружит дефект сборки, устранить его и повторить этот тест.
- [ ] **Step 2: Обновить README.** Описать оба способа разбивки, единицы и пределы, отдельные ссылки, сборку полного набора, ошибки, память и совместимость: старая страница не открывает v2. Удалить универсальное утверждение «файлы до 10 МБ», оставить его для скрытия/v1. Добавить контрольные сценарии следующего шага.
- [ ] **Step 3: Подготовить воспроизводимые образцы вне репозитория.** В task temp directory создать бинарный файл 37 × 1048576 байт с разнообразными воспроизводимыми байтами, пустой файл и небольшой файл с Unicode-именем. Сохранить исходные SHA-256 для сравнения со скачанными результатами. Не добавлять большие файлы или секреты в Git.
- [ ] **Step 4: Открыть пересобранный index.html через file: в доступном современном браузере.** Скачать все четыре PNG для 37 МиБ/count=4 и затем обе PNG для 37 МиБ/size=20 МиБ. Восстановить каждый комплект из скачанных файлов с перемешанными именами/порядком. Выполнить `cmp` исходного и каждого восстановленного файла; ожидать exit 0 и одинаковые SHA-256. Проверить реальные размеры PNG, ссылку на каждую часть, имя результата, исходный MIME-тип и счётчик прогресса.
- [ ] **Step 5: Выполнить отрицательные и совместимые браузерные сценарии.** Пропустить часть, повторить часть, смешать комплекты, ввести неверный пароль, подать JPEG и повреждённый PNG: ссылка на результат отсутствует, сообщение объясняет проблему. Проверить пустой файл, Unicode, одну часть v2, оба прежних режима v1, сохранение ограничения скрытия 10 МиБ, очистку всего списка после изменения входов, клавиатуру и узкую ширину окна. При загрузке страницы без нужного API все элементы запуска должны быть отключены с понятным сообщением.
- [ ] **Step 6: Проверить ресурсы на доступном устройстве.** Провести реальный цикл для части 64 МиБ и файла 512 МиБ, разбитого минимум на 8 частей; зафиксировать время, среду и наблюдаемую память там, где измерение доступно. Если внутри пределов получена ошибка, записать её и проверить очистку/повторную попытку. Не заявлять прохождение проверки, если браузер или ресурсный сценарий недоступен; сообщить ограничение. Изменение согласованных пределов требует согласования, а не скрытой корректировки реализации.
- [ ] **Step 7: Записать результаты и устранить обнаруженные дефекты.** В verification-файле перечислить действительно выполненные сценарии с результатами и известные ограничения; не отмечать невыполненные проверки как PASS. Для дефекта применить systematic-debugging и добавить проверку, воспроизводящую его, прежде чем исправлять.
- [ ] **Step 8: Выполнить финальную проверку.** `node scripts/build-standalone.js`, `node --test tests/*.test.js`, `git diff --check`, проверка состава diff и автономного HTML. Ожидать все тесты PASS и отсутствие ошибок whitespace; завершёнными считаются только подтверждённые браузерные проверки. Коммит изменённых файлов этапа: `test: verify standalone multipart PNG workflows`.

## Самопроверка и передача в выполнение

Покрытие спецификации: расчёты/границы/пустой файл — Task 1; пакет/AAD/ключ/IV/v1 — Task 2; параметры/прогресс/порционное чтение/скачивание/URL — Task 3; полный набор/ошибки/Blob/старое извлечение — Task 4; автономность/README/скачанные PNG/ресурсы — Task 5. Все пять пунктов Review Focus привязаны к проверкам. Имена полей PartInfo, возвращаемых сессий и вариантов version используются одинаково во всех этапах.

Спецификация одобрена пользователем. Этот план ещё требует его проверки и выбора способа выполнения; реализацию пока не начинать. Рекомендуемый способ — выполнение основным агентом по этапам (`superpowers:executing-plans`): этапы тесно связаны общими интерфейсами. Альтернатива — отдельные исполнители и проверки для каждого этапа (`superpowers:subagent-driven-development`). В обоих случаях перед завершением требуется независимое ревью всей реализации.
