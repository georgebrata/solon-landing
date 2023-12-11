(function () {
    "use strict";

    const URL = "https://script.google.com/macros/s/AKfycbyjMcA6j9Yz3_RGZn7jAL_rAPDDDgCPeIDUj5c50aXICq6jUFg1bzGqo9wxC-Dzh6w/exec?path=items";
    const faqList = document.getElementById("faq-list");
    const faqListParent = document.getElementById("faq");
    renderLibraryItems();


    async function renderLibraryItems() {
        let response, items;
        try {
            response = await fetch(URL);
            items = await response.json();
        } catch (error) {
            console.error(error);
            return;
        }

        hideLoading();
        let visibleItems = items.filter(item => item.Visible);
        console.log(visibleItems);

        if(visibleItems.length === 0) {
            faqListParent.classList.add("hidden");
            return; 
        } else {
            visibleItems.forEach((item, index) => {
                const element = {
                    intrebare: item.Intrebare,
                    raspuns: item.Raspuns,
                }
                if (item.Visible) {
                    appendItem(createFaqTemplate(element, index));
                }
            })
        }

    }

    const appendItem = (itemHtml) => {
        const newFaqListItem = document.createElement("li");
        newFaqListItem.innerHTML = itemHtml;

        faqList.appendChild(newFaqListItem);
    }

    const createFaqTemplate = (faqObject, index) => {
        let { intrebare, raspuns } = faqObject;

        return `<li data-aos="fade-in" data-aos-delay="${index*100}">
            <i class="bx bx-help-circle icon-help"></i>
            <a data-bs-toggle="collapse" class="collapse" data-bs-target="#faq-list-${index}">
                ${intrebare}
            <i class="bx bx-chevron-down icon-show"></i><i class="bx bx-chevron-up icon-close"></i>
            </a>
            <div id="faq-list-${index}" class="collapse" data-bs-parent=".faq-list">
            <p>
                ${raspuns}
            </p>
            </div>
        </li>`
    };

    const hideLoading = () => {
        const loading = document.getElementById("loading");
        loading.classList.add("hidden");
    }
})()
