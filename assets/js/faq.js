"use strict";

(function () {
    const URL = "https://script.google.com/macros/s/AKfycbyjMcA6j9Yz3_RGZn7jAL_rAPDDDgCPeIDUj5c50aXICq6jUFg1bzGqo9wxC-Dzh6w/exec?path=items";
    const faqList = document.getElementById("faq-list");
    const faqListParent = document.getElementById("faq");

    const appendItem = (itemHtml) => {
        const newFaqListItem = document.createElement("li");
        newFaqListItem.innerHTML = itemHtml;

        faqList.appendChild(newFaqListItem);
    };

    const createFaqTemplate = (faqObject, index) => {
        const { intrebare, raspuns } = faqObject;

        return `<li data-aos="fade-in" data-aos-delay="${index*100}">
            <i class="bx bx-help-circle icon-help"></i>
            <button type="button" data-bs-toggle="collapse" class="collapse collapsed" data-bs-target="#faq-list-${index}" aria-expanded="false" aria-controls="faq-list-${index}">
                ${intrebare}
            <i class="bx bx-chevron-down icon-show"></i><i class="bx bx-chevron-up icon-close"></i>
            </button>
            <div id="faq-list-${index}" class="collapse" data-bs-parent=".faq-list">
            <p>
                ${raspuns}
            </p>
            </div>
        </li>`;
    };

    const hideLoading = () => {
        document.getElementById("loading")?.classList.add("hidden");
    };

    const logFaqError = (error) => {
        const logger = globalThis?.SolonLog;
        if (typeof logger?.error === "function") {
            logger.error({
                type: "faq_load_error",
                message: error?.message,
                name: error?.name,
            });
            return;
        }
        console?.error("[solon error]", { type: "faq_load_error", name: error?.name });
    };

    const renderLibraryItems = async () => {
        if (!faqList || !faqListParent) return;

        let items;
        try {
            const response = await fetch(URL);
            if (!response.ok) throw new Error("FAQ request failed");
            items = await response.json();
        } catch (error) {
            logFaqError(error);
            hideLoading();
            faqListParent.classList.add("hidden");
            return;
        }

        hideLoading();
        const visibleItems = Array.isArray(items) ? items.filter((item) => item.Visible) : [];

        if (visibleItems.length === 0) {
            faqListParent.classList.add("hidden");
            return;
        }

        visibleItems.forEach((item, index) => {
            const element = {
                intrebare: item.Intrebare,
                raspuns: item.Raspuns,
            };
            if (item.Visible) {
                appendItem(createFaqTemplate(element, index));
            }
        });
    };

    renderLibraryItems().catch((error) => {
        logFaqError(error);
        hideLoading();
        faqListParent?.classList.add("hidden");
    });
})();
