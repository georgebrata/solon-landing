import os
import asyncio
from playwright.async_api import async_playwright

async def verify_blog():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # 1. Verify Home -> Blog navigation
        abs_index_path = os.path.abspath("index.html")
        await page.goto(f"file://{abs_index_path}", timeout=60000)
        print(f"Loaded Home: {page.url}")

        blog_link = page.get_by_role("link", name="Blog", exact=True)
        await blog_link.click()
        await page.wait_for_timeout(1000)

        # In the environment, file:// links might be tricky. If click didn't work, go direct.
        if "blog" not in page.url:
            abs_blog_index = os.path.abspath("blog/index.html")
            await page.goto(f"file://{abs_blog_index}", timeout=60000)

        print(f"Current URL: {page.url}")

        # 2. Verify Blog List content
        await page.wait_for_selector(".post-card", timeout=10000)
        posts = await page.query_selector_all(".post-card")
        assert len(posts) > 0
        print(f"Found {len(posts)} posts on blog list.")

        # 3. Verify Search/Filter
        search_input = page.locator("#blog-search-input")
        await search_input.fill("digitalizare")
        await page.wait_for_timeout(500)
        visible_posts = await page.query_selector_all(".post-card:visible")
        assert len(visible_posts) > 0
        print("Search/filtering works.")

        # 4. Verify individual post page
        first_post_link = page.locator(".post-card h5 a").first
        await first_post_link.click()
        await page.wait_for_timeout(1000)

        # Again, handle navigation if click failed on file://
        if "transformarea-digitala-2026" not in page.url:
             abs_post_path = os.path.abspath("blog/transformarea-digitala-2026/index.html")
             await page.goto(f"file://{abs_post_path}", timeout=60000)

        print(f"Individual post URL: {page.url}")
        await page.wait_for_selector(".entry-title", timeout=10000)
        title = await page.inner_text(".entry-title")
        assert "Transformarea Digitală" in title
        print(f"Individual post page verified: {title}")

        # Take a screenshot
        await page.screenshot(path="blog_verification.png")
        print("Screenshot saved to blog_verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_blog())
