export const deleteConfirmationMarkup = `<dialog id="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-message">
  <h2 id="delete-title">ごみ箱に移動しますか？</h2><p id="delete-message"></p>
  <form method="dialog"><label class="settings-check"><input id="delete-dont-ask" type="checkbox">今後このメッセージを表示しない</label>
    <div class="delete-actions"><button value="delete" autofocus>ごみ箱に移動</button><button value="cancel">キャンセル</button></div>
  </form></dialog>`;

export function confirmFileDeletion(name: string, directory: boolean): Promise<{confirmed: boolean; dontAskAgain: boolean}> {
  const dialog = document.getElementById('delete-dialog') as HTMLDialogElement;
  const checkbox = document.getElementById('delete-dont-ask') as HTMLInputElement;
  const cancel = dialog.querySelector<HTMLButtonElement>('[value=cancel]')!;
  document.getElementById('delete-message')!.textContent = `${name}${directory ? ' とその中の項目' : ''}をごみ箱に移動します。未保存の編集は無題のタブに残します。`;
  checkbox.checked = false; dialog.returnValue = 'cancel';
  dialog.onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing && event.target !== cancel) {
      event.preventDefault(); dialog.close('delete');
    }
  };
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve({ confirmed: dialog.returnValue === 'delete', dontAskAgain: dialog.returnValue === 'delete' && checkbox.checked }), {once:true});
    dialog.showModal(); dialog.querySelector<HTMLButtonElement>('[value=delete]')!.focus();
  });
}
