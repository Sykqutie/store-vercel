(async function () {
  'use strict';
  var A = App, esc = A.esc;
  var main = await A.mountShell('categories', 'owner');
  if (!main) return;

  var categories = [];
  main.innerHTML =
    '<div class="panel pad"><div class="ph"><h2>Categories</h2><span class="mono mute" id="catCount"></span></div>' +
    '<div class="note">New items are categorized automatically from their name. Existing products keep their current label until you edit them.</div>' +
    '<form id="addCat" class="toolbar" style="margin-top:14px"><input id="newCat" maxlength="60" placeholder="New category name" aria-label="New category name" autocomplete="off"><button class="btn primary" id="addCatBtn" type="submit">Add category</button></form>' +
    '<div class="alert" id="catErr" hidden></div>' +
    '<div class="tw"><table><thead><tr><th>Name</th><th class="n">Products</th><th>Status</th><th></th></tr></thead><tbody id="catBody"></tbody></table></div></div>' +
    '<div class="panel pad" style="margin-top:16px"><div class="ph"><h2>Merge categories</h2></div>' +
    '<div class="note">Move every product from one category into another, then remove the source. Products and sales history are kept.</div>' +
    '<form id="mergeForm" class="toolbar" style="margin-top:14px"><select id="mergeFrom" aria-label="Merge from category"></select><select id="mergeTo" aria-label="Merge into category"></select><button class="btn" id="mergeBtn" type="submit">Merge and remove source</button></form></div>';

  var body = A.$('#catBody');
  var err = A.$('#catErr');
  var mergeFrom = A.$('#mergeFrom');
  var mergeTo = A.$('#mergeTo');
  var mergeBtn = A.$('#mergeBtn');

  function showError(message) {
    err.textContent = message || '';
    err.hidden = !message;
  }

  function find(id) {
    return categories.filter(function (c) { return c.id === id; })[0];
  }

  function categoryOptions(list) {
    return list.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + (c.active ? '' : ' (inactive)') + '</option>';
    }).join('');
  }

  function render() {
    var active = categories.filter(function (c) { return c.active; }).length;
    A.$('#catCount').textContent = categories.length + ' total · ' + active + ' active';
    body.innerHTML = categories.length ? categories.map(function (c) {
      var fallback = c.is_fallback;
      return '<tr data-id="' + c.id + '"><td>' +
        (fallback
          ? '<b>' + esc(c.name) + '</b><div class="mono mute cat-sub">Protected fallback</div>'
          : '<input class="cat-input" data-id="' + c.id + '" maxlength="60" value="' + esc(c.name) + '" aria-label="Category name">') +
        '</td><td class="mono n">' + c.product_count + '</td><td>' +
        (c.active ? '<span class="pill ok">Active</span>' : '<span class="pill">Inactive</span>') +
        '</td><td class="cat-actions">' +
        (fallback ? '<span class="mono mute">Always active</span>'
          : '<button class="btn sm" type="button" data-save="' + c.id + '">Save name</button>' +
            '<button class="btn sm" type="button" data-toggle="' + c.id + '">' + (c.active ? 'Deactivate' : 'Activate') + '</button>') +
        '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">No categories yet.</td></tr>';

    var sources = categories.filter(function (c) { return !c.is_fallback; });
    var targets = categories.filter(function (c) { return !c.is_fallback && c.active; });
    var oldFrom = Number(mergeFrom.value) || 0;
    var oldTo = Number(mergeTo.value) || 0;
    mergeFrom.innerHTML = categoryOptions(sources) || '<option value="">No categories</option>';
    mergeTo.innerHTML = categoryOptions(targets) || '<option value="">No active categories</option>';
    if (sources.some(function (c) { return c.id === oldFrom; })) mergeFrom.value = String(oldFrom);
    if (targets.some(function (c) { return c.id === oldTo; })) mergeTo.value = String(oldTo);
    if (mergeTo.value === mergeFrom.value) {
      var different = targets.filter(function (c) { return String(c.id) !== mergeFrom.value; })[0];
      if (different) mergeTo.value = String(different.id);
    }
    mergeBtn.disabled = !sources.length || !targets.length || mergeFrom.value === mergeTo.value;
  }

  async function load() {
    showError('');
    try {
      var r = await A.api('/categories?all=1');
      categories = r.categories || [];
      render();
    } catch (e) {
      showError(e.message);
      body.innerHTML = '<tr><td colspan="4"><div class="alert">' + esc(e.message) + '</div></td></tr>';
      A.$('#catCount').textContent = '';
    }
  }

  A.$('#addCat').addEventListener('submit', async function (e) {
    e.preventDefault();
    var input = A.$('#newCat');
    var name = input.value.trim();
    if (!name) { showError('Enter a category name.'); input.focus(); return; }
    var btn = A.$('#addCatBtn');
    showError('');
    btn.disabled = true;
    try {
      await A.api('/categories', { method: 'POST', body: { name: name } });
      input.value = '';
      A.toast('Category added.');
      await load();
    } catch (ex) {
      showError(ex.message);
    } finally {
      btn.disabled = false;
    }
  });

  body.addEventListener('click', async function (e) {
    var save = e.target.closest('[data-save]');
    var toggle = e.target.closest('[data-toggle]');
    if (!save && !toggle) return;
    var id = Number((save || toggle).dataset.save || (save || toggle).dataset.toggle);
    var c = find(id);
    if (!c) return;
    showError('');
    if (save) {
      var input = body.querySelector('input[data-id="' + id + '"]');
      var name = input ? input.value.trim() : '';
      if (!name) { showError('Category name is required.'); if (input) input.focus(); return; }
      if (name === c.name) { A.toast('Category name is unchanged.'); return; }
      save.disabled = true;
      try {
        var result = await A.api('/categories/' + id, { method: 'PUT', body: { name: name } });
        A.toast('Category renamed' + (result.products_updated ? ' on ' + result.products_updated + ' product(s).' : '.'));
        await load();
      } catch (ex) {
        showError(ex.message);
        save.disabled = false;
      }
      return;
    }
    toggle.disabled = true;
    try {
      await A.api('/categories/' + id, { method: 'PUT', body: { active: !c.active } });
      A.toast(c.active ? 'Category deactivated.' : 'Category activated.');
      await load();
    } catch (ex) {
      showError(ex.message);
      toggle.disabled = false;
    }
  });

  mergeFrom.addEventListener('change', function () {
    if (mergeTo.value === mergeFrom.value) {
      var different = categories.filter(function (c) {
        return !c.is_fallback && c.active && String(c.id) !== mergeFrom.value;
      })[0];
      if (different) mergeTo.value = String(different.id);
    }
    mergeBtn.disabled = !mergeFrom.value || !mergeTo.value || mergeFrom.value === mergeTo.value;
  });
  mergeTo.addEventListener('change', function () {
    mergeBtn.disabled = !mergeFrom.value || !mergeTo.value || mergeFrom.value === mergeTo.value;
  });

  A.$('#mergeForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var source = find(Number(mergeFrom.value));
    var target = find(Number(mergeTo.value));
    if (!source || !target || source.id === target.id) {
      showError('Choose two different categories.');
      return;
    }
    if (!window.confirm('Move all products from "' + source.name + '" into "' + target.name + '" and remove "' + source.name + '"?')) return;
    showError('');
    mergeBtn.disabled = true;
    try {
      var result = await A.api('/categories/' + source.id + '/merge', {
        method: 'POST',
        body: { target_id: target.id }
      });
      A.toast('Merged into ' + result.target + ' (' + result.products_moved + ' product(s) moved).');
      await load();
    } catch (ex) {
      showError(ex.message);
      mergeBtn.disabled = false;
    }
  });

  A.reveal(main);
  await load();
})();
