const API = "http://localhost:8080";

const form = document.getElementById("ask");
const input = document.getElementById("question");
const button = form.querySelector("button");
const log = document.getElementById("log");
const examples = document.getElementById("examples");
let count = 0;

function el(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function showSources(answer, citations) {
  const list = el("ul", "sources");
  for (const c of citations) {
    const item = el("li", "", `${c.section} ${c.heading}`);
    if (c.url?.startsWith("https://")) {
      const link = el("a", "", item.textContent);
      link.href = c.url;
      link.target = "_blank";
      item.replaceChildren(link);
    }
    list.append(item);
  }
  answer.after(list);
}

async function ask(question, answer) {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, jurisdiction: "ON" }),
  });
  if (!res.ok) throw new Error();

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop();

    for (const block of blocks) {
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] || "{}");

      if (event === "token") answer.textContent += data.text;
      if (event === "citations") showSources(answer, data);
      if (event === "error") throw new Error();
    }
  }
}

async function submit(question) {
  question = question.trim();
  if (!question) return;

  examples.hidden = true;
  count++;
  const entry = el("article", "entry");
  const answer = el("p", "a");
  entry.append(el("span", "num", `Question ${count}`), el("p", "q", question), answer);
  log.prepend(entry);

  input.value = "";
  button.disabled = true;
  try {
    await ask(question, answer);
  } catch {
    answer.textContent = "Something went wrong. Please try again.";
  } finally {
    button.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit(input.value);
});

for (const b of examples.querySelectorAll("button")) {
  b.addEventListener("click", () => submit(b.textContent));
}
