// typeahead (only runs when #pref / #message / .suggestions ul exist — e.g. homepage contact section)
(function() {
  "use strict";

  const searchbox = document.querySelector("#pref");
  const messagebox = document.querySelector("#message");
  const suggestions = document.querySelector(".suggestions ul");

  if (!searchbox || !messagebox || !suggestions) {
    return;
  }

  const prefectures = [
    "Consultanță digitală",
    "Strategie marketing",
    "Personal branding",
    "Social Media",
    "SEO",
    "Campanii PPC / Ads",
    "Design logo",
    "Manual de brand",
    "Servicii foto profesionale",
    "Birotică personalizată",
    "Cărți de vizită",
    "Email personalizate",
    "UI/UX",
    "Copywriting",
    "Website",
    "Mobile (iOS / Android)",
    "QA",
    "Audit securitate",
  ];

  searchbox.placeholder = selectTwoRandomElements(prefectures);

  function selectTwoRandomElements(arr) {
    const randomIndexes = [];
    while (randomIndexes.length < 2) {
      const randomIndex = Math.floor(Math.random() * arr.length);
      if (!randomIndexes.includes(randomIndex)) {
        randomIndexes.push(randomIndex);
      }
    }
    const selectedElements = randomIndexes.map((index) => arr[index]);
    return selectedElements[0] + ", " + selectedElements[1] + ", ...";
  }

  function search(str) {
    const term = str.toLowerCase();
    const res = [];
    for (let i = 0; i < prefectures.length; i++) {
      if (prefectures[i].toLowerCase().indexOf(term) > -1) {
        res.push(prefectures[i]);
      }
    }
    return res;
  }

  function searchHandler(e) {
    const str = e.target.value;
    const res = search(str);
    if (res.length === 1) {
      searchbox.value = res[0];
      searchbox.blur();
      messagebox.focus();
      suggestions.classList.remove("has-suggestions");
    }
    showResults(res, str);
  }

  function showResults(res) {
    suggestions.innerHTML = "";
    if (res.length > 1) {
      for (let i = 0; i < res.length; i++) {
        const item = res[i];
        suggestions.innerHTML += `<li>${item}</li>`;
      }
      suggestions.classList.add("has-suggestions");
    }
  }

  function useSuggestion(e) {
    searchbox.value = e.target.innerText;
    searchbox.focus();
    suggestions.innerHTML = "";
    suggestions.classList.remove("has-suggestions");
  }

  function hideSuggestions() {
    suggestions.classList.remove("has-suggestions");
  }

  searchbox.addEventListener("keyup", searchHandler);
  searchbox.addEventListener("blur", hideSuggestions);
  suggestions.addEventListener("click", useSuggestion);
})();
