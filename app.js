function el(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async getJurisdictions() {
    const res = await fetch(`${this.baseUrl}/api/jurisdictions`);
    if (!res.ok) throw new Error();
    return res.json();
  }

  async *chat(question, jurisdiction) {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, jurisdiction }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.detail === "string" ? body.detail : "");
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n/g, "\n");

      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const event = ApiClient.parseEvent(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        if (event) yield event;
      }
    }
  }

  static parseEvent(block) {
    let type = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? { type, data: JSON.parse(data.join("\n")) } : null;
  }
}

class Markdown {
  static escape(text) {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  static inline(text) {
    return Markdown.escape(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  static render(text) {
    return text
      .split(/\n{2,}/)
      .map((block) => Markdown.renderBlock(block))
      .join("");
  }

  static renderBlock(block) {
    const html = [];
    let items = [];
    const flush = () => {
      if (items.length) html.push(`<ul>${items.map((i) => `<li>${Markdown.inline(i)}</li>`).join("")}</ul>`);
      items = [];
    };

    for (const line of block.split("\n").filter((l) => l.trim())) {
      const item = line.match(/^\s*[-*]\s+(.*)$/);
      if (item) {
        items.push(item[1]);
      } else {
        flush();
        html.push(`<p>${Markdown.inline(line)}</p>`);
      }
    }
    flush();
    return html.join("");
  }
}

class ChatApp {
  constructor(api) {
    this.api = api;
    this.form = document.getElementById("ask");
    this.input = document.getElementById("question");
    this.select = document.getElementById("jurisdiction");
    this.caption = document.getElementById("caption");
    this.button = this.form.querySelector("button");
    this.log = document.getElementById("log");
    this.examples = document.getElementById("examples");
    this.count = 0;
  }

  start() {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit(this.input.value);
    });
    this.select.addEventListener("change", () => this.updateCaption());
    for (const b of this.examples.querySelectorAll("button")) {
      b.addEventListener("click", () => this.submit(b.textContent));
    }
    this.loadJurisdictions();
  }

  async loadJurisdictions() {
    try {
      const list = await this.api.getJurisdictions();
      this.select.replaceChildren();
      for (const j of list) {
        const option = el("option", "", j.enabled ? j.name : `${j.name} (coming soon)`);
        option.value = j.code;
        option.disabled = !j.enabled;
        option.dataset.name = j.name;
        this.select.append(option);
      }
      this.select.value = list.find((j) => j.enabled)?.code ?? "ON";
    } catch {}
    this.updateCaption();
  }

  updateCaption() {
    const option = this.select.selectedOptions[0];
    this.caption.textContent = `Renting in ${option?.dataset.name || option?.textContent || "Ontario"}`;
  }

  showCitations(container, citations) {
    if (!citations.length) return;

    const list = el("ul", "sources");
    for (const c of citations) {
      const item = el("li", "");
      const link = el("a", "", `${c.source_title}, s. ${c.section}: ${c.heading}`);
      link.href = c.url;
      link.target = "_blank";
      link.rel = "noopener";
      item.append(link);
      list.append(item);
    }
    container.append(el("h3", "sources-title", "Sources"), list);
  }

  async submit(question) {
    question = question.trim();
    if (!question) return;

    this.examples.hidden = true;
    this.count++;
    const entry = el("article", "entry");
    const status = el("p", "status", "Checking the Act…");
    const answer = el("div", "answer");
    entry.append(el("span", "num", `Question ${this.count}`), el("p", "q", question), status);
    this.log.prepend(entry);

    this.input.value = "";
    this.button.disabled = true;
    let text = "";
    try {
      for await (const { type, data } of this.api.chat(question, this.select.value)) {
        if (type === "token") {
          if (!text) status.replaceWith(answer);
          text += data.text;
          answer.innerHTML = Markdown.render(text);
        } else if (type === "citations") {
          this.showCitations(entry, data);
        } else if (type === "error") {
          throw new Error(data.detail || data.message || "");
        }
      }
      if (!text) status.textContent = "No answer was returned. Try rewording your question.";
    } catch (err) {
      status.textContent = err.message || "Something went wrong. Please try again.";
      status.classList.add("error");
      if (text) entry.append(status);
    } finally {
      this.button.disabled = false;
    }
  }
}

new ChatApp(new ApiClient("http://localhost:8080")).start();
