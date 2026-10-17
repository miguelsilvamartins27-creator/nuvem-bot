
(() => {
  const $p = selector => document.querySelector(selector);
  let tasks = [];
  let notes = [];
  let tasksLoaded = false;
  let notesLoaded = false;
  let editingTaskId = null;
  let editingNoteId = null;

  function safeText(value) { return String(value == null ? "" : value); }
  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function status(selector, message, isError) {
    const el = $p(selector);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("error-text", !!isError);
  }
  function localDate(value) {
    if (!value) return "";
    const parts = String(value).slice(0, 10).split("-");
    if (parts.length !== 3) return String(value);
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }
  function emptyState(icon, title, description) {
    const el = make("div", "productivity-empty");
    el.append(make("span", "productivity-empty-icon", icon), make("strong", "", title), make("small", "", description));
    return el;
  }
  function setTab(name) {
    document.querySelectorAll("[data-productivity-tab]").forEach(button => {
      const active = button.dataset.productivityTab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".productivity-subview").forEach(view => {
      view.classList.toggle("active", view.id === "productivity-subview-" + name);
    });
    if (name === "tasks") loadTasks();
    if (name === "notes") loadNotes();
  }
  document.querySelectorAll("[data-productivity-tab]").forEach(button => {
    button.addEventListener("click", () => setTab(button.dataset.productivityTab));
  });

  function visibleTasks() {
    const query = safeText($p("#task-search")?.value).trim().toLocaleLowerCase("pt-BR");
    const filter = $p("#task-filter")?.value || "all";
    return tasks.filter(task => {
      const matchesQuery = !query || [task.title, task.description, task.priority].some(value => safeText(value).toLocaleLowerCase("pt-BR").includes(query));
      const matchesFilter = filter === "all" || task.status === filter;
      return matchesQuery && matchesFilter;
    });
  }
  function renderTasks() {
    const area = $p("#task-list");
    if (!area) return;
    area.replaceChildren();
    const list = visibleTasks();
    const openCount = tasks.filter(task => task.status !== "completed").length;
    const count = $p("#task-count");
    if (count) count.textContent = openCount + " pendente" + (openCount === 1 ? "" : "s");
    const tabCount = $p("#task-tab-count");
    if (tabCount) tabCount.textContent = String(openCount);
    if (!list.length) {
      area.appendChild(emptyState("✓", tasks.length ? "Nenhuma tarefa neste filtro" : "Seu espaço começa aqui", tasks.length ? "Tente mudar a pesquisa ou o filtro de status." : "Adicione uma tarefa para transformar seus planos em próximos passos."));
      return;
    }
    for (const task of list) {
      const article = make("article", "productivity-item");
      const check = make("input", "productivity-item-check");
      check.type = "checkbox";
      check.checked = task.status === "completed";
      check.setAttribute("aria-label", (check.checked ? "Reabrir " : "Concluir ") + task.title);
      check.addEventListener("change", async () => {
        check.disabled = true;
        try {
          await api("/api/app/tasks/" + encodeURIComponent(task.id), { method: "PATCH", body: JSON.stringify({ status: check.checked ? "completed" : "pending" }) });
          await loadTasks(true);
        } catch (error) {
          check.checked = !check.checked;
          status("#task-status", error.message || "Não foi possível atualizar a tarefa.", true);
        } finally { check.disabled = false; }
      });
      const main = make("div", "productivity-item-main");
      const top = make("div", "productivity-item-top");
      const title = make("h3", "productivity-item-title" + (task.status === "completed" ? " completed" : ""), task.title);
      top.appendChild(title);
      main.appendChild(top);
      if (task.description) main.appendChild(make("p", "productivity-item-description", task.description));
      const meta = make("div", "productivity-item-meta");
      const priorityText = { high: "Prioridade alta", medium: "Prioridade média", low: "Prioridade baixa" }[task.priority] || "Prioridade média";
      meta.appendChild(make("span", "productivity-chip priority-" + (task.priority || "medium"), priorityText));
      const statusText = { pending: "Pendente", in_progress: "Em andamento", completed: "Concluída" }[task.status] || "Pendente";
      meta.appendChild(make("span", "productivity-chip", statusText));
      if (task.due_date) meta.appendChild(make("span", "productivity-chip", "Prazo " + localDate(task.due_date)));
      main.appendChild(meta);
      const actions = make("div", "productivity-item-actions");
      const edit = make("button", "", "Editar");
      edit.type = "button";
      edit.addEventListener("click", () => {
        editingTaskId = task.id;
        $p("#task-title").value = task.title || "";
        $p("#task-description").value = task.description || "";
        $p("#task-priority").value = task.priority || "medium";
        $p("#task-due-date").value = task.due_date || "";
        $p("#task-submit").textContent = "Salvar alterações";
        $p("#task-cancel-edit").hidden = false;
        status("#task-status", "Editando tarefa. Salve para confirmar.");
        $p("#task-title").focus();
        $p("#task-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      const progress = make("button", "", task.status === "in_progress" ? "Marcar pendente" : "Em andamento");
      progress.type = "button";
      progress.addEventListener("click", async () => {
        progress.disabled = true;
        try {
          const next = task.status === "in_progress" ? "pending" : "in_progress";
          await api("/api/app/tasks/" + encodeURIComponent(task.id), { method: "PATCH", body: JSON.stringify({ status: next }) });
          await loadTasks(true);
        } catch (error) { status("#task-status", error.message || "Não foi possível atualizar a tarefa.", true); }
        finally { progress.disabled = false; }
      });
      const remove = make("button", "", "Excluir");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!confirm("Excluir a tarefa “" + task.title + "”?")) return;
        remove.disabled = true;
        try {
          await api("/api/app/tasks/" + encodeURIComponent(task.id), { method: "DELETE" });
          tasks = tasks.filter(item => item.id !== task.id);
          renderTasks();
          status("#task-status", "Tarefa excluída.");
        } catch (error) { status("#task-status", error.message || "Não foi possível excluir a tarefa.", true); }
        finally { remove.disabled = false; }
      });
      actions.append(edit, progress, remove);
      main.appendChild(actions);
      article.append(check, main);
      area.appendChild(article);
    }
  }
  async function loadTasks(force) {
    if (!session?.access_token || (tasksLoaded && !force)) return;
    status("#task-status", "Carregando tarefas…");
    try {
      const data = await api("/api/app/tasks");
      tasks = Array.isArray(data.tasks) ? data.tasks : [];
      tasksLoaded = true;
      renderTasks();
      status("#task-status", tasks.length ? "✓ Suas tarefas estão sincronizadas com sua conta." : "Nenhuma tarefa salva ainda.");
    } catch (error) {
      status("#task-status", error.message || "Não foi possível carregar as tarefas.", true);
      const area = $p("#task-list");
      if (area) { area.replaceChildren(emptyState("!", "Não foi possível carregar", "Verifique a conexão e tente novamente.")); }
    }
  }
  function resetTaskForm() {
    editingTaskId = null;
    $p("#task-form")?.reset();
    $p("#task-priority").value = "medium";
    $p("#task-submit").textContent = "＋ Criar tarefa";
    $p("#task-cancel-edit").hidden = true;
  }
  $p("#task-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!session?.access_token) return status("#task-status", "Entre na conta para salvar tarefas.", true);
    const title = $p("#task-title").value.trim();
    if (!title) return status("#task-status", "Digite um título para a tarefa.", true);
    const body = {
      title,
      description: $p("#task-description").value.trim(),
      priority: $p("#task-priority").value,
      due_date: $p("#task-due-date").value || null
    };
    const button = $p("#task-submit");
    button.disabled = true;
    status("#task-status", editingTaskId ? "Salvando alterações…" : "Criando tarefa…");
    try {
      if (editingTaskId) await api("/api/app/tasks/" + encodeURIComponent(editingTaskId), { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/app/tasks", { method: "POST", body: JSON.stringify(body) });
      resetTaskForm();
      tasksLoaded = false;
      await loadTasks(true);
      status("#task-status", editingTaskId ? "Tarefa atualizada." : "✓ Tarefa salva na sua conta.");
    } catch (error) { status("#task-status", error.message || "Não foi possível salvar a tarefa.", true); }
    finally { button.disabled = false; }
  });
  $p("#task-cancel-edit")?.addEventListener("click", () => { resetTaskForm(); status("#task-status", "Edição cancelada."); });
  $p("#task-search")?.addEventListener("input", renderTasks);
  $p("#task-filter")?.addEventListener("change", renderTasks);

  function visibleNotes() {
    const query = safeText($p("#note-search")?.value).trim().toLocaleLowerCase("pt-BR");
    return notes.filter(note => !query || [note.title, note.content].some(value => safeText(value).toLocaleLowerCase("pt-BR").includes(query)));
  }
  function renderNotes() {
    const area = $p("#note-list");
    if (!area) return;
    area.replaceChildren();
    const list = visibleNotes();
    const count = $p("#note-count");
    if (count) count.textContent = notes.length + " nota" + (notes.length === 1 ? "" : "s");
    const tabCount = $p("#note-tab-count");
    if (tabCount) tabCount.textContent = String(notes.length);
    if (!list.length) {
      area.appendChild(emptyState("✎", notes.length ? "Nenhuma nota encontrada" : "Guarde uma ideia", notes.length ? "Tente outro termo de pesquisa." : "Anotações, ideias e informações importantes ficam reunidas aqui."));
      return;
    }
    for (const note of list) {
      const card = make("article", "productivity-note" + (note.is_pinned ? " pinned" : ""));
      const head = make("div", "productivity-note-head");
      const title = make("h3", "", note.title);
      head.appendChild(title);
      if (note.is_pinned) head.appendChild(make("span", "productivity-chip productivity-pin", "★ Fixada"));
      card.append(head, make("p", "productivity-note-content", note.content || "Nota sem conteúdo."));
      const foot = make("div", "productivity-note-foot");
      foot.appendChild(make("span", "", "Atualizada " + localDate(note.updated_at)));
      const actions = make("div", "productivity-note-actions");
      const pin = make("button", "", note.is_pinned ? "Desafixar" : "Fixar");
      pin.type = "button";
      pin.addEventListener("click", async () => {
        pin.disabled = true;
        try { await api("/api/app/notes/" + encodeURIComponent(note.id), { method: "PATCH", body: JSON.stringify({ is_pinned: !note.is_pinned }) }); await loadNotes(true); }
        catch (error) { status("#note-status", error.message || "Não foi possível atualizar a nota.", true); }
        finally { pin.disabled = false; }
      });
      const edit = make("button", "", "Editar");
      edit.type = "button";
      edit.addEventListener("click", () => {
        editingNoteId = note.id;
        $p("#note-title").value = note.title || "";
        $p("#note-content").value = note.content || "";
        $p("#note-pinned").checked = !!note.is_pinned;
        $p("#note-submit").textContent = "Salvar alterações";
        $p("#note-cancel-edit").hidden = false;
        status("#note-status", "Editando nota. Salve para confirmar.");
        $p("#note-title").focus();
        $p("#note-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      const remove = make("button", "", "Excluir");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!confirm("Excluir a nota “" + note.title + "”?")) return;
        remove.disabled = true;
        try { await api("/api/app/notes/" + encodeURIComponent(note.id), { method: "DELETE" }); notes = notes.filter(item => item.id !== note.id); renderNotes(); status("#note-status", "Nota excluída."); }
        catch (error) { status("#note-status", error.message || "Não foi possível excluir a nota.", true); }
        finally { remove.disabled = false; }
      });
      actions.append(pin, edit, remove);
      foot.appendChild(actions);
      card.appendChild(foot);
      area.appendChild(card);
    }
  }
  async function loadNotes(force) {
    if (!session?.access_token || (notesLoaded && !force)) return;
    status("#note-status", "Carregando notas…");
    try {
      const data = await api("/api/app/notes");
      notes = Array.isArray(data.notes) ? data.notes : [];
      notesLoaded = true;
      renderNotes();
      status("#note-status", notes.length ? "✓ Suas notas estão sincronizadas com sua conta." : "Nenhuma nota salva ainda.");
    } catch (error) {
      status("#note-status", error.message || "Não foi possível carregar as notas.", true);
      const area = $p("#note-list");
      if (area) area.replaceChildren(emptyState("!", "Não foi possível carregar", "Verifique a conexão e tente novamente."));
    }
  }
  function resetNoteForm() {
    editingNoteId = null;
    $p("#note-form")?.reset();
    $p("#note-submit").textContent = "＋ Salvar nota";
    $p("#note-cancel-edit").hidden = true;
  }
  $p("#note-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!session?.access_token) return status("#note-status", "Entre na conta para salvar notas.", true);
    const title = $p("#note-title").value.trim();
    const content = $p("#note-content").value.trim();
    if (!title) return status("#note-status", "Digite um título para a nota.", true);
    const body = { title, content, is_pinned: $p("#note-pinned").checked };
    const button = $p("#note-submit");
    button.disabled = true;
    status("#note-status", editingNoteId ? "Salvando alterações…" : "Salvando nota…");
    try {
      if (editingNoteId) await api("/api/app/notes/" + encodeURIComponent(editingNoteId), { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/app/notes", { method: "POST", body: JSON.stringify(body) });
      resetNoteForm();
      notesLoaded = false;
      await loadNotes(true);
      status("#note-status", "✓ Nota salva na sua conta.");
    } catch (error) { status("#note-status", error.message || "Não foi possível salvar a nota.", true); }
    finally { button.disabled = false; }
  });
  $p("#note-cancel-edit")?.addEventListener("click", () => { resetNoteForm(); status("#note-status", "Edição cancelada."); });
  $p("#note-search")?.addEventListener("input", renderNotes);

  window.addEventListener("nuvem:viewchange", event => {
    if (event.detail?.view !== "organizacao") return;
    if (!session?.access_token) {
      status("#task-status", "Entre na sua conta para acessar suas tarefas.", true);
      status("#note-status", "Entre na sua conta para acessar suas notas.", true);
      return;
    }
    const active = document.querySelector("[data-productivity-tab].active")?.dataset.productivityTab || "tasks";
    if (active === "tasks") loadTasks();
    else loadNotes();
  });
  window.addEventListener("nuvem:authenticated", () => {
    tasksLoaded = false;
    notesLoaded = false;
    if (document.querySelector("#view-organizacao.active")) setTab("tasks");
  });
})();
