// =========================================================
// DataMatcher - main script
// 処理の流れ
//  0) 共有状態（DB貼り付け生TSV）
//  1) 初期化（イベント登録）
//  2) イベントハンドラ（比較実行もここが入口）
//  3) UI生成（Form/Bean/突き合わせキー候補）
//  4) 描画（比較結果）
//  5) 解析（TSV/改行）ユーティリティ
//  6) JSON整形（Form/Bean/index）ユーティリティ
//  7) 比較（突き合わせ・一致判定）ユーティリティ
// =========================================================

// -----------------------------
// 0) 共有状態（DB貼り付け生TSV）
// -----------------------------

/**
 * textareaは貼り付け時に改行コードを正規化してしまうため、
 * DB貼り付けの「生TSV」を別途保持する。
 * @type {string|null}
 */
let rawDbTsv = null;

/**
 * DB貼り付けTSVの「生文字列」を保持する。
 * @param {string|null|undefined} nextRaw
 * @returns {void}
 */
function setRawDbTsv(nextRaw) {
    rawDbTsv = nextRaw == null ? null : String(nextRaw);
}

/**
 * DB貼り付けTSVを取得する（pasteで取得できていればそれを優先）。
 * @returns {string}
 */
function getRawDbTsv() {
    const dbTextarea = document.getElementById('db-textarea');
    return rawDbTsv ?? dbTextarea.value;
}

// -----------------------------
// 1) 初期化（イベント登録）
// -----------------------------

// 画面起動時にイベントリスナーを登録
document.addEventListener('DOMContentLoaded', function(){
    // 入力欄
    const dbTextarea = document.getElementById('db-textarea');
    const jsonTextarea = document.getElementById('json-textarea');

    // 選択欄 / 操作ボタン
    const formSelector = document.getElementById('form-selector');
    const beanSelector = document.getElementById('bean-selector');
    const compareButton = document.getElementById('compare-btn');
    const showNgOnlyCheckbox = document.getElementById('filter-ng-only');
    const joinKeySelect = document.getElementById('json-join-key');

    // DB貼り付け・編集（確定時に更新）
    dbTextarea.addEventListener('paste', onDbTextareaPaste);
    dbTextarea.addEventListener('change', onDbTextareaChangeRawSync);

    // JSON貼り付け
    jsonTextarea.addEventListener('change', createFormSelector);

    // form / bean 選択
    formSelector.addEventListener('change', onFormSelectorChange);
    beanSelector.addEventListener('change', onBeanSelectorChange);

    // 比較実行
    compareButton.addEventListener('click', onCompareClick);

    // NGのみ表示
    showNgOnlyCheckbox.addEventListener('change', onFilterNgOnlyChange);

    // 突き合わせキー選択
    joinKeySelect.addEventListener('change', scheduleSelectorRefresh);

    // 初期状態（DB未入力）では突き合わせキーを無効化
    scheduleSelectorRefresh();
});

// -----------------------------
// 2) イベントハンドラ
// -----------------------------

/**
 * DB貼り付け時にクリップボードの生テキストを取得する。
 * @param {ClipboardEvent} e
 * @returns {void}
 */
function onDbTextareaPaste(e) {
    const dbTextarea = e.currentTarget;
    const pastedText = e.clipboardData?.getData('text/plain');
    if (typeof pastedText !== 'string') return;

    // textarea側の改行正規化を避けるため、貼り付けは自前で行う
    e.preventDefault();
    setRawDbTsv(pastedText);

    // カーソル位置に挿入
    const start = dbTextarea.selectionStart ?? dbTextarea.value.length;
    const end = dbTextarea.selectionEnd ?? dbTextarea.value.length;
    const beforeCursor = dbTextarea.value.slice(0, start);
    const afterCursor = dbTextarea.value.slice(end);
    dbTextarea.value = beforeCursor + pastedText + afterCursor;

    const nextCursor = start + pastedText.length;
    dbTextarea.selectionStart = dbTextarea.selectionEnd = nextCursor;

    // DB内容が変わったので、突き合わせキー候補を更新
    scheduleSelectorRefresh();
}

/**
 * 手入力/編集の確定時に rawDbTsv を textarea.value に一致させる。
 * @returns {void}
 */
function onDbTextareaChangeRawSync() {
    const dbTextarea = document.getElementById('db-textarea');
    setRawDbTsv(dbTextarea.value);

    // DB内容が変わったので、突き合わせキー候補を更新
    scheduleSelectorRefresh();
}

/**
 * Formラジオ選択が変わったら Bean 候補を作り直す。
 * @param {Event} e
 * @returns {void}
 */
function onFormSelectorChange(e) {
    // ラジオのvalue（= formKey）でBean候補を作り直す
    createBeanSelector(e.target.value);
}

/**
 * Beanラジオ選択が変わったら突き合わせキー候補を更新する。
 * @param {Event} e
 * @returns {void}
 */
function onBeanSelectorChange(e) {
    // Beanが変わったので、突き合わせキー候補を更新
    scheduleSelectorRefresh();
}

/**
 * 比較実行（JSON/DB解析 → compareJsonAndDb → 描画）。
 * @returns {void}
 */
function onCompareClick() {
    // 入力取得
    const jsonText = document.getElementById('json-textarea').value;
    const dbTsvText = getRawDbTsv();
    const selectedFormKey = document.querySelector('input[name="form-radio"]:checked')?.value;
    const selectedBeanKey = document.querySelector('input[name="bean-radio"]:checked')?.value;
    const jsonJoinKey = document.getElementById('json-join-key').value;

    if(jsonText === document.getElementById('db-textarea').value){
        alert('入力は完全に一致しています。');
        return;
    }

    // 入力チェック
    if (!jsonText || !dbTsvText || !selectedFormKey || !selectedBeanKey) {
        alert('入力と選択を確認してください');
        return;
    }

    try {
        // JSON解析（選択form/beanに絞る）
        const fullFormData = JSON.parse(jsonText)[selectedFormKey];
        const jsonData = extractJsonSubsetByBean(fullFormData, selectedBeanKey);

        // DB解析（ヘッダ行＋データ行）
        const parsedDb = parseDbTsv(dbTsvText);
        if (!parsedDb) return alert('DB結果の解析に失敗しました（ヘッダー行が必要です）');
        const { headers, rows: dbRows } = parsedDb;
        if (dbRows.length === 0) return alert('DB結果のデータ行が見つかりません');

        // 比較処理（複数行突き合わせ含む）
        const { results, formOnlyFields, dbOnlyFields } = compareJsonAndDb({
            jsonData,
            headers,
            dbRows,
            jsonJoinKey
        });

        // 比較結果描画
        renderResults(results, formOnlyFields, dbOnlyFields);
    } catch (err) {
        alert('解析に失敗しました:。');
        console.error(err.message);
    }
}

/**
 * NGのみ表示トグル。
 * @param {Event} e
 * @returns {void}
 */
function onFilterNgOnlyChange(e) {
    const rows = document.querySelectorAll('#result-table-body tr');

    rows.forEach(row => {
        if (e.target.checked) {
            // NGバッジが表示されていない行は隠す
            const ngBadge = row.querySelector('.status-ng');
            const isVisibleNg = ngBadge && !ngBadge.classList.contains('hidden');
            if (!isVisibleNg) row.classList.add('hidden');
        } else {
            // 全件表示に戻す
            row.classList.remove('hidden');
        }
    });
}

// -----------------------------
// 3) UI生成（Form/Bean/突き合わせキー候補）
// -----------------------------

/**
 * JSONテキストエリアの内容から、比較対象Form（トップレベルキー）を抽出して
 * ラジオボタンとして表示する。
 *
 * - 前提: JSON構造は `{ [formKey]: { [name]: value } }` の形
 * - 挙動: 最初のformKeyを自動選択し、bean候補生成も続けて実行する
 * @returns {void}
 */
function createFormSelector(){
    //  ラジオボタン初期化
    const area = document.getElementById('form-selector');
    area.innerHTML = '';
    document.getElementById('bean-selector').innerHTML = '';
    document.getElementById('compare-btn').disabled = true;
    
    try {
        const data = JSON.parse(document.getElementById('json-textarea').value);
        // JSONのトップレベルのキー（Form名）をラジオボタンにする
        const template = document.getElementById('radio-template');
        let firstKey = null;
        Object.keys(data).forEach((key, index) => {
            // テンプレートの複製
            const clone = template.content.cloneNode(true);
            
            // input要素の設定
            const input = clone.querySelector('input');
            input.name = "form-radio";
            input.value = key;
            if (index === 0){
                input.checked = true;
                firstKey = key;
            } 
            
            // テキスト部分の設定
            const span = clone.querySelector('.radio-label-text');
            span.textContent = key;
            
            area.appendChild(clone);
        });

        // bean選択肢生成関数呼び出し
        if (firstKey) {
            createBeanSelector(firstKey);
        }
    } catch (e) {
        // パース失敗時
        console.error(e.message);
    }
}

/**
 * 選択されたFormの中身（name一覧）から、Bean候補（パス）を抽出してラジオ表示する。
 *
 * ここでいう "Bean" は `a.b.c` のようなnameを「最後のドットより前」で区切ったパス。
 * さらに `list[0]` のようなindexは同一リスト扱いとして除去し、`list` として集約する。
 *
 * - 例: `userBean.name` -> `userBean`
 * - 例: `list[0].name` / `list[1].name` -> `list`
 *
 * @param {string} selectedFormKey - 選択されたFormのキー
 * @returns {void}
 */
function createBeanSelector(selectedFormKey){
    // JSONから選択フォームのname一覧を取り出して、Bean候補を作る
    const jsonText = document.getElementById('json-textarea').value;
    const beanArea = document.getElementById('bean-selector');
    const template = document.getElementById('radio-template');
    
    // 初期化
    beanArea.innerHTML = ''; 

    try {
        const fullData = JSON.parse(jsonText);
        const formData = fullData[selectedFormKey];
        if (!formData) return;

        const beanNames = new Set();
        // 最上位(MainBean)は必ず存在するものとして最初に追加
        beanNames.add("最上位(MainBean)");

        Object.keys(formData).forEach(key => {
            // ドットが含まれている＝階層構造であると判定
            if (key.includes('.')) {
                // 1. 最後のドットより前を「Beanパス」として抜き出す
                // 例: "userBean.name" -> "userBean"
                // 例: "list[0].name" -> "list[0]"
                const lastDotIndex = key.lastIndexOf('.');
                let beanPath = key.substring(0, lastDotIndex);

                // 2. もしインデックス [0] 等が含まれていたら、それは同一リストなので除去
                // 例: "list[0]" -> "list"
                beanPath = beanPath.replace(/\[\d+\]/g, '');

                if (beanPath) {
                    beanNames.add(beanPath);
                }
            }
        });

        // 選択肢の生成
        Array.from(beanNames).forEach((beanName) => {
            const clone = template.content.cloneNode(true);
            const input = clone.querySelector('input');
            const span = clone.querySelector('.radio-label-text');

            input.name = "bean-radio";
            input.value = beanName;
            
            // 「最上位(MainBean)」を初期選択にする
            if (beanName === "最上位(MainBean)") {
                input.checked = true;
                document.getElementById('compare-btn').disabled = false;
            }

            span.textContent = beanName;
            beanArea.appendChild(clone);
        });

        scheduleSelectorRefresh();
    } catch (e) {
        console.error("Bean解析失敗:", e);
    }
}

/**
 * 「突き合わせキー（name末尾）」の候補プルダウンを、現在の選択内容から再生成する。
 *
 * - 対象範囲: 選択Form/BeanでフィルタしたJSONキー群
 * - 候補: `a.b.c` の leaf（最後のdot以降）を列挙（例: id, name...）
 *
 * @returns {void}
 */
function scheduleSelectorRefresh(){
    // 入力・選択状態を取得
    const jsonText = document.getElementById('json-textarea').value;
    const dbTsvText = getRawDbTsv();
    const selectedFormKey = document.querySelector('input[name="form-radio"]:checked')?.value;
    const selectedBeanKey = document.querySelector('input[name="bean-radio"]:checked')?.value;
    const jsonJoinSelect = document.getElementById('json-join-key');

    // 以前の選択を退避（候補更新後に復元する）
    const previousJoinKey = jsonJoinSelect.value;

    // 初期化（先頭の自動は保持）
    jsonJoinSelect.innerHTML = '<option value="">(自動 / 未指定)</option>';

    // DBが未入力なら候補は作らない（DBヘッダが無いと突き合わせキーは成立しない）
    if (!dbTsvText || String(dbTsvText).trim() === "") {
        jsonJoinSelect.disabled = true;
        return;
    }

    // DBヘッダを取得（候補の絞り込みに使う）
    let dbHeaderSet = null;
    try {
        const parsedDb = parseDbTsv(dbTsvText);
        if (parsedDb?.headers?.length) dbHeaderSet = new Set(parsedDb.headers);
    } catch (e) {
        dbHeaderSet = null;
    }
    if (!dbHeaderSet) {
        jsonJoinSelect.disabled = true;
        return;
    }

    jsonJoinSelect.disabled = false;

    // JSONの選択範囲（form/bean）が揃っている場合のみ候補生成
    if (jsonText && selectedFormKey && selectedBeanKey) {
        const fullFormData = JSON.parse(jsonText)[selectedFormKey];
        const jsonData = extractJsonSubsetByBean(fullFormData, selectedBeanKey);
        const candidates = inferJoinKeyCandidates(jsonData);

        // DBに存在するカラムに対応する候補だけを出す（key -> UPPER_SNAKE をヘッダで確認）
        for (const candidateKey of candidates) {
            if (!dbHeaderSet.has(toUpperSnake(candidateKey))) continue;
            const optionElement = document.createElement('option');
            optionElement.value = candidateKey;
            optionElement.textContent = candidateKey;
            jsonJoinSelect.appendChild(optionElement);
        }
    }

    // 前回の選択を保持（候補から消えていたら自動/未指定へ戻る）
    if (previousJoinKey && Array.from(jsonJoinSelect.options).some(o => o.value === previousJoinKey)) {
        jsonJoinSelect.value = previousJoinKey;
    }
}

// -----------------------------
// 4) 描画（比較結果）
// -----------------------------

/**
 * 比較結果表示関数
 * - メイン: JSONキーと対応DBカラムの値比較（OK/NG）
 * - JSONのみ: DBに対応カラムが無かった項目
 * - DBのみ: JSON側で比較に使われなかったカラム（行ラベル付き）
 *
 * @param {Array<{rowLabel?:string, property:string, column:string, jsonVal:string, dbVal:string, isMatch:boolean}>} results
 * @param {Array<{jsonKey:string, val:any}>} formOnlyFields
 * @param {Array<{header:string, val:any, rowLabel?:string}>} dbOnlyFields
 * @returns {void}
 */
function renderResults(results, formOnlyFields, dbOnlyFields) {
    const resTable = document.getElementById('result-table-body');
    const jsonSide = document.getElementById('only-form-body');
    const dbSide = document.getElementById('only-db-body');
    
    const resTemp = document.getElementById('result-row-template');
    const diffTemp = document.getElementById('diff-row-template');

    // 初期化（前回結果をクリア）
    [resTable, jsonSide, dbSide].forEach(el => el.innerHTML = '');
    const fragments = { main: new DocumentFragment(), json: new DocumentFragment(), db: new DocumentFragment() };
    document.getElementById('filter-ng-only').checked = false;
    
    results.forEach(res => {
        // A. メイン比較テーブル（JSON値 vs DB値）
        const clone = resTemp.content.cloneNode(true);
        clone.querySelector('.row-label').textContent = res.rowLabel ?? "";
        clone.querySelector('.property-name').textContent = res.property;
        clone.querySelector('.column-name').textContent = res.column;
        clone.querySelector('.json-val').textContent = res.jsonVal;
        clone.querySelector('.db-val').textContent = res.dbVal;
        
        const status = res.isMatch ? '.status-ok' : '.status-ng';
        clone.querySelector(status).classList.remove('hidden');
        fragments.main.appendChild(clone);
    });

    // B. JSONにのみ存在するリスト
    formOnlyFields.forEach(field => {
        const sClone = diffTemp.content.cloneNode(true);
        const nameEl = sClone.querySelector('.diff-name');
        const valEl = sClone.querySelector('.diff-value');
        
        nameEl.classList.add('text-red-600');
        nameEl.textContent = field.jsonKey;
        valEl.textContent = `Value: ${normalizeNewlinesToCrlf(String(field.val ?? ""))}`; // JSON側の値を表示（改行はCRLF扱い）
        
        sClone.querySelector('td').classList.add('bg-red-50');
        fragments.json.appendChild(sClone);
    });

    // C. DBにのみ存在するリスト
    dbOnlyFields.forEach(field => {
        // ヘッダーが空の場合は表示をスキップ
        if (!field.header) return;

        const sClone = diffTemp.content.cloneNode(true);
        const nameEl = sClone.querySelector('.diff-name');
        const valEl = sClone.querySelector('.diff-value');
        
        nameEl.classList.add('text-yellow-700');
        nameEl.textContent = field.rowLabel ? `${field.rowLabel} / ${field.header}` : field.header;
        valEl.textContent = `Value: ${normalizeNewlinesToCrlf(String(field.val ?? ""))}`; // DB側の値を表示（改行はCRLF扱い）
        
        sClone.querySelector('td').classList.add('bg-yellow-50');
        fragments.db.appendChild(sClone);
    });

    // DOMへ一括反映（Fragmentでまとめて描画）
    resTable.appendChild(fragments.main);
    jsonSide.appendChild(fragments.json);
    dbSide.appendChild(fragments.db);
}

// -----------------------------
// 5) 解析（TSV/改行）ユーティリティ
// -----------------------------

/**
 * MySQL Workbench等からコピーしたTSV（タブ区切りテキスト）を解析する。
 *
 * - 1行目: ヘッダー（カラム名）
 * - 2行目以降: データ行（複数行可）
 * - 行区切り: CRLF(\r\n) （※CRはデータ内改行）
 *
 * @param {string} dbRaw - TSV生テキスト
 * @returns {{headers: string[], rows: Array<Record<string,string>>} | null}
 */
function parseDbTsv(dbRaw){
    // 行分割・空行除去
    const lines = splitTsvLines(dbRaw)
                    .map(l => l.replace(/\n/g, '')) // 念のため: LF単体が来た場合は行終端側で処理する想定
                    .filter(l => l.trim() !== ""); // 空行を除去
    if (lines.length === 0) return null;
    // Tabで分割してヘッダーを取得
    const headers = lines[0].split('\t').map(h => h.trim());
    if (headers.length === 0 || headers.every(h => h === "")) return null;
    // 2行目以降をデータ行として取得
    const rows = lines.slice(1).map(line => {
        // Tabで分割してデータを取得
        const cols = line.split('\t');
        // データをオブジェクトに格納
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = String(cols[i] ?? "");
        });
        return obj;
    });
    return { headers, rows };
}

/**
 * TSVの行分割
 * - CRLF(\r\n) は「行の終端」
 * - CR(\r) 単体は「データ内改行」とみなし、行分割しない
 * - ただし、CRLFが全く無い入力では LF(\n) を行終端とする
 *
 * @param {string} raw
 * @returns {string[]}
 */
function splitTsvLines(raw){
    if (raw == null) return [];
    const s = String(raw);

    // 基本: CRLFでのみ区切る（CR単体は残す）
    if (s.includes('\r\n')) {
        return s.split('\r\n');
    }

    // フォールバック: CRLFが無い場合のみ LF で区切る
    return s.split('\n');
}

/**
 * 改行コードをCRLFに正規化する（比較・表示用の正規化）
 *
 * このツールでは、以下の2種類の「改行」を区別して扱う。
 * - **行終端**: DB貼り付けTSV上の CRLF(\r\n)（TSVの行区切り）
 * - **データ内改行**: 値の中の CR(\r)
 *
 * ただし比較/表示の段階では、見た目と一致判定を安定させるため、
 * 値に含まれる改行はすべて CRLF(\r\n) に統一する。
 *
 * ※データ内改行（CR単体）の直後には必ず半角スペースが1つ付与されるため、
 * 　その **1つだけ** を削除してから正規化する。
 *
 * @param {any} value - 任意の値（null/undefined可）
 * @returns {string} CRLFに統一された文字列
 */
function normalizeNewlinesToCrlf(value){
    const s = value == null ? "" : String(value);
    // データ内の「CR改行」は、直後に半角スペースが1つ付与される仕様のため除去する
    // - CRLF(\r\n) は行終端として扱うため対象外
    // - CR単体(\r) の直後にある「半角スペース1つ」だけを削除
    const cleaned = s.replace(/\r(?!\n) /g, '\r');
    // いったん全改行を \n に寄せてから CRLF に統一
    return cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
}

// -----------------------------
// 6) JSON整形（Form/Bean/index）ユーティリティ
// -----------------------------

/**
 * Form全体のJSON（name->valueマップ）から、選択Bean配下だけを抽出する。
 *
 * - "最上位(MainBean)" の場合は **フォーム直下（ドットを含まないname）だけ**を返す
 * - それ以外は、`beanPath.leaf` 形式のキーだけを対象にする
 * - リストのindex（[0]等）は Bean識別の際に除去して比較する
 *
 * @param {Record<string, any>} fullFormData
 * @param {string} selectedBeanKey
 * @returns {Record<string, any>}
 */
function extractJsonSubsetByBean(fullFormData, selectedBeanKey){
    if (!fullFormData || typeof fullFormData !== 'object') return {};
    if (selectedBeanKey === "最上位(MainBean)") {
        // フォーム直下のみ（nameにドットが無いもの）
        const subset = {};
        Object.keys(fullFormData).forEach(key => {
            if (!key.includes('.')) subset[key] = fullFormData[key];
        });
        return subset;
    }

    const subset = {};
    Object.keys(fullFormData).forEach(key => {
        // beanPath抽出（最後のdotより前、かつindexは除去）
        if (!key.includes('.')) return;
        const lastDotIndex = key.lastIndexOf('.');
        let beanPath = key.substring(0, lastDotIndex);
        beanPath = beanPath.replace(/\[\d+\]/g, '');
        if (beanPath === selectedBeanKey) subset[key] = fullFormData[key];
    });
    return subset;
}

/**
 * 「突き合わせキー(name末尾)」の候補を推測する。
 *
 * ここではJSONのキー（name）から leaf（最後のdot以降）を抽出して候補にする。
 * - 例: `list[0].id` -> `id`
 * - 例: `userBean.userId` -> `userId`
 *
 * @param {Record<string, any>} jsonData - Bean抽出済みのname->value
 * @returns {string[]} leaf候補の配列
 */
function inferJoinKeyCandidates(jsonData){
    const keys = Object.keys(jsonData || {});
    if (keys.length === 0) return [];

    const candidates = new Set();
    keys.forEach(jsonKey => {
        const lastDot = jsonKey.lastIndexOf('.');
        const leaf = lastDot === -1 ? jsonKey : jsonKey.substring(lastDot + 1);
        if (leaf) candidates.add(leaf);
    });

    return Array.from(candidates);
}

/**
 * JSONのname->valueマップを、`[index]` ごとにグルーピングする。
 *
 * - `[0]` を含むキーは groups に入る（keyは "0" のような文字列）
 * - indexが無いキーは noIndex に入る
 *
 * @param {Record<string, any>} jsonData
 * @returns {{groups: Map<string, Record<string, any>>, noIndex: Record<string, any>}}
 */
function groupJsonByIndex(jsonData){
    const groups = new Map();
    const noIndex = {};

    Object.entries(jsonData || {}).forEach(([jsonKey, value]) => {
        // すべての [数字] を抽出
        const allMatches = jsonKey.match(/\[\d+\]/g);
        
        if (!allMatches) {
            noIndex[jsonKey] = value;
            return;
        }

        // すべてのインデックスを繋げて一つのユニークなキーにする
        // 例: "projects[0].members[1].name" -> "0-1"
        const groupKey = allMatches.map(m => m.replace(/\D/g, '')).join('-');

        if (!groups.has(groupKey)) groups.set(groupKey, {});
        groups.get(groupKey)[jsonKey] = value;
    });

    return { groups, noIndex };
}

/**
 * DBカラム名への変換
 *
 * JSONのnameキー（leaf）からDBヘッダーを引くための変換。
 * 基本は「leafをUPPER_SNAKEにする」。
 *
 * @param {string} jsonKey - JSONのname（例: list[0].userId / userId）
 * @returns {string} DBカラム名想定（例: USER_ID）
 */
function jsonKeyToDbColumn(jsonKey) {
    const lastDot = jsonKey.lastIndexOf('.');
    const leaf = lastDot === -1 ? jsonKey : jsonKey.substring(lastDot + 1);
    return toUpperSnake(leaf);
}

/**
 * キャメルケースをアッパースネークケースに変換する関数
 * - 例: userId -> USER_ID
 * @param {string} str - camelCase想定の文字列
 * @returns {string} UPPER_SNAKE_CASE
 */
function toUpperSnake(str) {
    return str
        .replace(/([A-Z])/g, '_$1') // すべての大文字の前に _ を入れる
        .toUpperCase()              // 全体を大文字にする
}

// -----------------------------
// 7) 比較（突き合わせ・一致判定）ユーティリティ
// -----------------------------

/**
 * メイン比較関数
 *
 * 入力JSONがリスト形式かどうか（nameに[index]が含まれるか）で処理を分岐する。
 *
 * - リスト形式:
 *   - indexごとにJSONをグルーピング
 *   - joinKeyが指定されていれば「値一致」でDB行を割当（1DB行は1回だけ）
 *   - 見つからなければ未使用DB行を順番にフォールバック割当
 *   - 各割当単位で compareFlat を実行し、rowLabel を付与
 *   - DBのみ項目は行ラベル付きで蓄積（どのDB行の値かが分かる）
 *
 * - 単一形式:
 *   - DB先頭行（DB行1）と compareFlat
 *
 * @param {object} args
 * @param {Record<string, any>} args.jsonData
 * @param {string[]} args.headers
 * @param {Array<Record<string, string>>} args.dbRows
 * @param {string} args.jsonJoinKey - JSON側で選択されたname末尾（未指定可）
 * @returns {{
 *   results: Array<{rowLabel:string, property:string, column:string, jsonVal:string, dbVal:string, isMatch:boolean}>,
 *   formOnlyFields: Array<{jsonKey:string, val:any}>,
 *   dbOnlyFields: Array<{header:string, val:any, rowLabel?:string}>
 * }}
 */
function compareJsonAndDb({ jsonData, headers, dbRows, jsonJoinKey }) {
    const totalResults = [];
    const usedDbRowIndices = new Set();

    const { groups, noIndex } = groupJsonByIndex(jsonData);
    const hasIndexGroups = groups.size > 0 && Object.keys(noIndex).length === 0;

    // A. リスト形式（Indexグループあり）の場合
    if (hasIndexGroups && dbRows.length > 1) {
        const allFormOnly = [];
        const perRowDbOnlyAgg = [];
        const sortedIndices = Array.from(groups.keys()).sort((a, b) => {
            const arrA = a.split('-').map(Number);
            const arrB = b.split('-').map(Number);

            // 階層の深さが同じであることが保証されているため、単純なループで比較
            for (let i = 0; i < arrA.length; i++) {
                if (arrA[i] !== arrB[i]) {
                    return arrA[i] - arrB[i];
                }
            }
            return 0;
        });

        console.log(groups);
        console.log(sortedIndices);

        // 紐付け結果を一時保持するマップ (listIndex -> matchedObject)
        const matchMap = new Map();

        // --- JoinKeyによる厳密一致を優先 ---
        if (jsonJoinKey && jsonJoinKey.trim() !== "") {
            sortedIndices.forEach(listIndex => {
                const groupObj = groups.get(listIndex);
                const matched = findMatchedDbRow(groupObj, dbRows, headers, usedDbRowIndices, jsonJoinKey);

                if (matched) {
                    usedDbRowIndices.add(matched.rowIdx);
                    matchMap.set(listIndex, matched);
                }
            });
        }

        console.log(matchMap);

        // --- 漏れた要素に未使用行を割り当て ---
        sortedIndices.forEach(listIndex => {
            // 既に一致済みの場合はスキップ
            if (matchMap.has(listIndex)) return;

            const groupObj = groups.get(listIndex);
            let matched = null;

            // JoinKey未指定、または指定があっても見つからなかった要素へのフォールバック
            const fallbackRowIndex = dbRows.findIndex((_, i) => !usedDbRowIndices.has(i));
            if (fallbackRowIndex !== -1) {
                matched = { rowIdx: fallbackRowIndex, row: dbRows[fallbackRowIndex] };
                usedDbRowIndices.add(fallbackRowIndex);
                matchMap.set(listIndex, matched);
            }
        });

        // --- 比較実行 ---
        sortedIndices.forEach(listIndex => {
            const groupObj = groups.get(listIndex);
            const matched = matchMap.get(listIndex) || null;

            const rowLabel = matched
                ? `JSON[${listIndex}] ⇔ DB行${matched.rowIdx + 1}`
                : `JSON[${listIndex}] ⇔ (DB未一致)`;

            const { results, formOnlyFields, dbOnlyFields } = compareFlat(
                groupObj, matched?.row ?? null, rowLabel, headers
            );

            totalResults.push(...results);
            allFormOnly.push(...formOnlyFields);
            dbOnlyFields.forEach(field => {
                perRowDbOnlyAgg.push({ header: field.header, val: field.val, rowLabel });
            });
        });

        return {
            results: totalResults,
            formOnlyFields: allFormOnly,
            dbOnlyFields: perRowDbOnlyAgg
        };
    }

    // B. 単一データ形式の場合
    const { results, formOnlyFields, dbOnlyFields } = compareFlat(
        jsonData, dbRows[0] ?? null, "DB行1", headers
    );

    return {
        results,
        formOnlyFields,
        dbOnlyFields: (dbOnlyFields || []).map(field => ({ ...field, rowLabel: "DB行1" }))
    };
}

/**
 * 特定のJSONグループに一致するDB行を検索する
 *
 * 突き合わせキー（name末尾）を joinKey として、DBの該当カラム（UPPER_SNAKE）と値一致する行を探す。
 * - 既に別のJSON index に割り当て済みのDB行（usedDbRowIndices）は再利用しない
 * - joinKeyが未指定、またはDBに該当カラムが存在しない場合は null
 *
 * @param {Record<string, any>} groupObj - JSONの1グループ（同一indexのname->value）
 * @param {Array<Record<string, string>>} dbRows - DBデータ行配列（ヘッダをキーにしたオブジェクト）
 * @param {string[]} headers - DBヘッダ配列
 * @param {Set<number>} usedDbRowIndices - 既に使用したDB行のインデックス
 * @param {string} joinKey - JSON側で選択した「name末尾」
 * @returns {{rowIdx:number, row:Record<string,string>} | null}
 */
function findMatchedDbRow(groupObj, dbRows, headers, usedDbRowIndices, joinKey) {
    if (!joinKey || !headers.includes(toUpperSnake(joinKey))) return null;

    // groupの中からjoinKeyに一致する値を取得
    const joinEntry = Object.entries(groupObj).find(([jsonKey]) => {
        const lastDot = jsonKey.lastIndexOf('.');
        const leaf = lastDot === -1 ? jsonKey : jsonKey.substring(lastDot + 1);
        return leaf === joinKey;
    });
    if (!joinEntry) return null;

    const joinValue = String(joinEntry[1] ?? "");
    const joinDbColumn = toUpperSnake(joinKey);

    const rowIdx = dbRows.findIndex((row, i) =>
        !usedDbRowIndices.has(i) && String(row[joinDbColumn] ?? "") === joinValue
    );

    if (rowIdx === -1) return null;
    return { rowIdx, row: dbRows[rowIdx] };
}

/**
 * 1つのJSONオブジェクトと1つのDB行を比較する
 *
 * - JSONの各nameキーに対して、対応するDBカラム（jsonKeyToDbColumnで変換）を探す
 * - 存在しない場合は「JSONにのみ存在」へ
 * - 存在する場合は、値をCRLF正規化した上で一致判定し、メイン結果へ
 * - DB側で比較に使わなかったカラムは「DBにのみ存在」へ（値は表示用にCRLF正規化）
 *
 * @param {Record<string, any>} jsonObj - 比較対象JSON（name->value）
 * @param {Record<string, string>|null} dbRowObj - 比較対象DB行（header->value）。未一致の場合nullもあり得る
 * @param {string} rowLabel - どの行同士を比較したかの表示用ラベル
 * @param {string[]} headers - DBヘッダ配列
 * @returns {{
 *   results: Array<{rowLabel:string, property:string, column:string, jsonVal:string, dbVal:string, isMatch:boolean}>,
 *   formOnlyFields: Array<{jsonKey:string, val:any}>,
 *   dbOnlyFields: Array<{header:string, val:string}>
 * }}
 */
function compareFlat(jsonObj, dbRowObj, rowLabel, headers) {
    const results = [];
    const formOnlyFields = [];
    const comparedDbCols = new Set();

    Object.keys(jsonObj).forEach(jsonKey => {
        const dbCol = jsonKeyToDbColumn(jsonKey);
        const exists = headers.includes(dbCol);

        if (!exists) {
            formOnlyFields.push({ jsonKey, val: jsonObj[jsonKey] });
            return;
        }

        comparedDbCols.add(dbCol);

        const jsonValue = normalizeNewlinesToCrlf(String(jsonObj[jsonKey] ?? ""));
        const dbValue = normalizeNewlinesToCrlf(String(dbRowObj?.[dbCol] ?? ""));

        results.push({
            rowLabel,
            property: jsonKey,
            column: dbCol,
            jsonVal: jsonValue,
            dbVal: dbValue,
            isMatch: jsonValue === dbValue
        });
    });

    const dbOnlyFields = headers
        .filter(header => header && !comparedDbCols.has(header))
        .map(header => ({ header, val: normalizeNewlinesToCrlf(String(dbRowObj?.[header] ?? "")) }));

    return { results, formOnlyFields, dbOnlyFields };
}