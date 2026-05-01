/**
 * 画面上の[name]属性を持つ要素から値を抽出し、
 * JSON形式でクリップボードにコピーするスクリプト
 */
(function() {
    const allFormData = {};
    const forms = document.querySelectorAll("form");

    if (forms.length === 0) {
        alert("画面内にform要素が見つかりませんでした。");
        return;
    }

    forms.forEach((form, index) => {
        const formData = {};
        // form内のname属性を持つ要素のみを取得
        const elements = form.querySelectorAll("input[name], select[name], textarea[name]");

        // フォームを識別するためのキー（idがあればid、なければインデックス）
        const formKey = form.id || `form_${index}`;

        for (let el of elements) {
            const { name, type, checked, value, disabled } = el;

            // name属性が未定義、空文字 ("")、_csrf、disabledの要素は除外
            if (!name || name.trim() === "" || name === "_csrf" || disabled) continue;

            // ラジオボタン・チェックボックスは選択されているものだけを取得
            if ((type === "radio" || type === "checkbox") && !checked) {
                continue;
            }

            // 同一フォーム内での重複チェック
            if (formData[name] !== undefined) {
                // エラーを出して終了
                alert(`重複したname属性があります。対象：${name}`);
                return; 
            }

            // 値取得
            formData[name] = value;
        }

        // 空のフォームでなければ追加
        if (Object.keys(formData).length > 0) {
            allFormData[formKey] = formData;
        }
    });

    // 全フォームの項目の合計数を計算
    const totalItems = Object.values(allFormData).reduce((sum, form) => sum + Object.keys(form).length, 0);
    const formCount = Object.keys(allFormData).length;

    if (totalItems === 0) {
        alert("有効な入力データが見つかりませんでした。");
        return;
    }

    // JSON化（タブインデント）
    const jsonText = JSON.stringify(allFormData, null, "\t");
    // クリップボードにコピー
    navigator.clipboard.writeText(jsonText)
        .then(() => {
            alert(`コピー成功\n対象: ${formCount} フォーム\n総数: ${totalItems} 項目`);
        })
        .catch(err => {
            alert("コピーに失敗しました。HTTPS環境であることを確認し、画面内の要素をフォーカスした状態で再度実行してください。");
            console.error("Clipboard Error:", err);
        });
})();