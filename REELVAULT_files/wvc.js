window["WPCache"] = new WvcUtils.WPCache();

if (window["WVCMenus"]) {
  window["WVCMenus"]["menusDetailed"].forEach((menu) => {
    window["WPCache"].set(
        `getWithNamespace_wvc/v1_menus/${menu.id}`,
        [`menus/${menu.id}`, {}, "wvc/v1"],
        { data: menu, headers: { wvc_localized: true }, status: 200 },
    );
  });
  console.log(window["WPCache"]);
}
window["WPClient"] = WvcUtils.createWordPressClient(
    window["WVC"].homeUrl,
    window["WPCache"],
);

class WvcClient {
  async getLogo(skipCache = false) {
    const cached = window["WVCLogo"];
    if (cached?.url && !skipCache)
      return { attachment_id: cached.attachment_id, url: cached.url };
    const logoData = await window["WPClient"].get_logo({}, skipCache);
    return logoData?.data ?? null;
  }

  async setLogo(attachmentId) {
    const homeUrl = window["WVC"].homeUrl.replace(/\/+$/, "");
    const wvcNonce = window["WVC"].nonce;
    const wpRestNonce = this.get_rest_nonce();

    // Add wvc_theme_nonce to URL as query parameter (not in JSON body)
    const endpoint = `${homeUrl}/wp-json/wvc/v1/logo`;
    const endpointWithNonce = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'wvc_theme_nonce=' + wvcNonce;

    const response = await fetch(endpointWithNonce, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": wpRestNonce,
      },
      body: JSON.stringify({ attachment_id: attachmentId }),
    });
    if (!response.ok) {
      throw new Error(`setLogo failed: ${response.status}`);
    }
    const result = await response.json();

    // Update local cache so getLogo() returns the new logo immediately
    window["WVCLogo"] = {
      attachment_id: attachmentId,
      url: result.url || "",
    };
    window.dispatchEvent(new Event("WVC_LOGO_REFRESH"));

    return result;
  }

  async getMenuItems({ menuId } = {}) {
    const menu_items_data = await window["WPClient"].get_menu_items(menuId);
    return menu_items_data?.data ?? [];
  }

  getCurrentPostID() {
    return window["WVC"].postId;
  }
  getCurrentTermID() {
    return window["WVC"].termId;
  }

  getCurrentWPQuery() {
    return window["WVC"].wpQuery;
  }

  getCurrentPostType() {
    return window["WVC"].postType || "post";
  }
  getCurrentTaxonomy() {
    return window["WVC"].taxonomy;
  }

  isShop() {
    return Object.keys(window["WVC"].woo || {}).length > 0;
  }

  async getCart(flushCache = true){
    try {
      const result = await window["WPClient"].get_cart({}, flushCache);
      return result?.data ?? {};
    } catch (error) {
      console.error("getCart error:", error);
      return {};
    }
  }

  async getCartItems(flushCache = true) {
    try {
      const result = await window["WPClient"].get_cart_items({}, flushCache);
      return result?.data ?? [];
    } catch (error) {
      console.error("getItems error:", error);
      return [];
    }
  }

  async getPosts(postParams = {}, postType = "post") {
    const wpQueryParams = postParams?.wp_query ?? {};
    const params = {
      ...wpQueryParams,
      _fields: postParams?.fields,
      _embed: postParams?.embeds ?? [],
    };
    let maybePostType = postParams?.postType ?? "";
    if (maybePostType && postType === "post") {
      postType = maybePostType;
    }

    // Always call get_posts and let it handle routing to get_items for custom post types
    // do not skip flush cache param false
    const post_data = await window["WPClient"].get_posts(
        params,
        false,
        postType,
    );

    return {
      posts: post_data?.data,
      total: post_data?.headers["x-wp-total"],
      total_pages: post_data?.headers["x-wp-totalpages"],
    };
  }

  async getTerms(termParams = {}) {
    const wpTermQueryParams = termParams?.wp_term_query ?? {};
    const params = {
      ...wpTermQueryParams,
      _fields: termParams?.fields,
      _embed: termParams?.embeds ?? [],
      taxonomy: termParams?.taxonomy,
    };

    const terms_data = await window["WPClient"].get_terms(params);

    return {
      terms: terms_data?.data,
      total: terms_data?.headers["x-wp-total"],
      total_pages: terms_data?.headers["x-wp-totalpages"],
    };
  }

  async get_wp_query_results(query = {}, params = {}, cache = false) {
    var prefs = {};
    var woo = window["WVC"].woo || {};
    if (Object.keys(woo).length > 0) {
      prefs = { ...woo };
    }
    const post_data = await window["WPClient"].rest_wp_query(
        query,
        params,
        cache,
        prefs,
    );

    return {
      posts: post_data?.data,
      total: post_data?.headers["x-wp-total"],
      total_pages: post_data?.headers["x-wp-totalpages"],
    };
  }

  async get_wp_term_query_results(query = {}, params = {}, cache = false) {
    const terms_data = await window["WPClient"].rest_wp_term_query(
        query,
        params,
        cache,
    );
    const defaultProductCategory = Number(
        window["WVC"]?.woo?.defaultProductCategory || 0,
    );
    const terms = Array.isArray(terms_data?.data)
        ? terms_data.data.filter((term) => {
          const termId = Number(term?.id || 0);
          const termSlug = String(term?.slug || "").toLowerCase();
          if (defaultProductCategory > 0) {
            return termId !== defaultProductCategory;
          }
          return termSlug !== "uncategorized";
        })
        : [];

    return {
      terms,
      total: terms_data?.headers["x-wp-total"],
      total_pages: terms_data?.headers["x-wp-totalpages"],
    };
  }

  getCurrentWPQueryParams() {
    return window["WVC"].wpQueryParams || {};
  }

  getTemplateViewType() {
    return window["WVC"]?.viewType || "";
  }

  isSearchResultsPage() {
    return this.getTemplateViewType() === "search";
  }

  is404Page() {
    return this.getTemplateViewType() === "404" || Boolean(window["WVC"]?.is404);
  }

  getSearchQuery() {
    const wvc = window["WVC"] || {};
    if (typeof wvc.searchQuery === "string" && wvc.searchQuery !== "") {
      return wvc.searchQuery;
    }
    if (typeof wvc.wpQuery?.search === "string" && wvc.wpQuery.search !== "") {
      return wvc.wpQuery.search;
    }
    if (typeof wvc.wpQueryParams?.search === "string" && wvc.wpQueryParams.search !== "") {
      return wvc.wpQueryParams.search;
    }
    if (typeof URLSearchParams !== "undefined") {
      const term = new URLSearchParams(window.location.search).get("s");
      if (term) {
        return term;
      }
    }
    return "";
  }

  buildSearchUrl(query) {
    const homeUrl = (window["WVC"]?.homeUrl || "/").replace(/\/+$/, "");
    const term = typeof query === "string" ? query.trim() : "";
    if (!term) {
      return `${homeUrl}/`;
    }
    return `${homeUrl}/?s=${encodeURIComponent(term)}`;
  }

  getCurrentWPTermQueryParams() {
    return window["WVC"].wpTermQueryParams || {};
  }

  get_allowed_taxonomies(post_type = "post") {
    if (!post_type || !window["WVC"]?.allowedTaxonomies) {
      return [];
    }
    const taxonomies = window["WVC"].allowedTaxonomies[post_type];
    return Array.isArray(taxonomies) ? taxonomies : [];
  }

  get_allowed_meta(post_type = "post") {
    if (!post_type || !window["WVC"]?.allowedMeta) {
      return [];
    }
    const meta = window["WVC"].allowedMeta[post_type];
    return Array.isArray(meta) ? meta : [];
  }

  async get_breadcrumbs(cache = false) {
    const wp_query_params = window["WVC"].wpQueryParams || {};
    const wp_term_params = window["WVC"].wpTermQueryParams || {};
    const result = await window["WPClient"].rest_shop_breadcrumbs(
        wp_query_params,
        wp_term_params,
        cache,
    );
    const breadcrumbs = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result)
            ? result
            : [];

    const shopPage = window["WVC"].shopPage || {};
    const hasValidShopPageId = shopPage.id != null && Number(shopPage.id) !== 0;

    const shopItem = hasValidShopPageId
        ? {
          link: shopPage.link || "#",
          title: shopPage.title || "Shop",
        }
        : {
          link: "#",
          title: "Shop",
        };

    const withShop = [shopItem, ...breadcrumbs];

    return result?.data != null ? { ...result, data: withShop } : withShop;
  }

  async get_product_filters(query = {}) {
    const result = await window["WPClient"].woocommerce_product_filters(query);
    return result?.data ?? { params: [] };
  }

  /**
   * Call a custom WVC plugin's public REST endpoint.
   *
   * `path` is the full namespaced route exactly as the plugin's guide lists it,
   * e.g. 'wvc-bookings/v1/items' or 'wvc-bookings/v1/items/94'.
   *
   *   const data = await wvcClient.pluginRequest('wvc-bookings/v1/items', {
   *     params: { per_page: 20 },
   *   });
   *
   *   const booking = await wvcClient.pluginRequest('wvc-bookings/v1/bookings', {
   *     method: 'POST',
   *     data: { item_id, slot_start, customer_name, customer_email, hp: '' },
   *   });
   *
   * Resolves the response BODY and REJECTS on any non-2xx with
   * { code, message, status }. The rejection matters: generated code treats a
   * resolved promise as success, so swallowing a failure would report a rejected
   * booking as confirmed.
   *
   * Reads are uncached by default — plugin data is availability and capacity, and
   * a stale slot list offers seats that are already gone. Pass `cache: true` to
   * opt in.
   *
   * Wraps window.WPClient.client (the WordPress facade exposes the real client
   * there) so generated code never reaches into it, and so the editor preview can
   * mirror this same signature over its postMessage bridge.
   */
  async pluginRequest(path, options = {}) {
    const { method = "GET", data, params, cache = false } = options;

    const segments = String(path || "")
      .split("/")
      .filter(Boolean);
    // A plugin route is always <slug>/v<n>/<endpoint…>, so the namespace is the
    // first two segments and everything after it is the endpoint.
    if (segments.length < 3) {
      throw {
        code: "plugin_bad_path",
        message: `Expected a namespaced route like 'wvc-bookings/v1/items', got '${path}'`,
        status: 0,
      };
    }
    const namespace = segments.slice(0, 2).join("/");
    const endpoint = segments.slice(2).join("/");

    // Owner routes need credentials this client does not send, so they would 401.
    // Owner data belongs to the plugin's own wp-admin screens, never to site code.
    if (segments.includes("admin")) {
      throw {
        code: "plugin_owner_route",
        message: `'${path}' is an owner route and is not reachable from the site`,
        status: 0,
      };
    }

    // Only GET and POST: a namespace can only be carried by
    // getWithNamespace/postWithNamespace, so PUT and DELETE would silently be
    // sent to wp/v2 instead of the plugin.
    if (method !== "GET" && method !== "POST") {
      throw {
        code: "plugin_bad_method",
        message: `pluginRequest supports GET and POST, got '${method}'`,
        status: 0,
      };
    }

    const client = window["WPClient"]?.client;
    if (!client) {
      throw {
        code: "plugin_client_unavailable",
        message: "The WordPress client is not available on this page",
        status: 0,
      };
    }

    try {
      const response =
        method === "GET"
          ? await client.getWithNamespace(endpoint, params, namespace, !cache)
          : await client.postWithNamespace(endpoint, data, params, namespace);
      return response?.data;
    } catch (error) {
      // The client throws { code, message, data: { status } }; flatten it so
      // callers read one shape, and so the preview bridge can carry it.
      throw {
        code: error?.code || "plugin_request_failed",
        message: error?.message || "The request failed",
        status: error?.data?.status ?? 0,
      };
    }
  }

  async formSubmission({
                         // Required fields
                         sectionName,
                         formId,
                         formData,

                         // Optional metadata
                         validationErrors = null,
                         submissionAttempt = 1,
                         formVersion = "1.0.0",
                         ...rest
                       } = {}) {
    if (!sectionName || !formId || !formData) {
      throw new Error(
          "Required fields missing: sectionName, formId, and formData are required",
      );
    }

    // console.log("Submitting form:", {
    //   sectionName,
    //   formId,
    //   formData,
    //   validationErrors,
    //   submissionAttempt,
    //   formVersion,
    //   ...rest,
    // });

    // Auto-generated fields
    const timestamp = Date.now();
    const sessionId = this.generateSessionId();
    const pageUrl = window.location.href;
    const userAgent = navigator.userAgent;

    // Prepare the submission data
    const submissionData = new FormData();

    // Add all form field values
    if (formData instanceof FormData) {
      for (const [key, value] of formData.entries()) {
        submissionData.append(`formData[${key}]`, value);
      }
    } else {
      // Handle object format
      for (const [key, value] of Object.entries(formData)) {
        // Handle File and FileList objects properly
        if (value instanceof File) {
          submissionData.append(`formData[${key}]`, value);
        } else if (value instanceof FileList) {
          for (let i = 0; i < value.length; i++) {
            submissionData.append(`formData[${key}]`, value[i]);
          }
        } else if (value !== undefined && value !== null) {
          submissionData.append(`formData[${key}]`, value);
        }
      }
    }

    // Add metadata
    submissionData.append("sectionName", sectionName);
    submissionData.append("formId", formId);
    submissionData.append("timestamp", timestamp.toString());
    submissionData.append("sessionId", sessionId);
    submissionData.append("pageUrl", pageUrl);
    submissionData.append("userAgent", userAgent);
    submissionData.append("submissionAttempt", submissionAttempt.toString());
    submissionData.append("formVersion", formVersion);

    if (validationErrors) {
      submissionData.append(
          "validationErrors",
          JSON.stringify(validationErrors),
      );
    }

    // Add AJAX action and nonce for security
    if (window.wvcHandlerData && window.wvcHandlerData.nonce) {

      submissionData.append("action", window.wvcHandlerData.action); // AJAX action
      submissionData.append("nonce", window.wvcHandlerData.nonce);
    }

    // console.log("Submission data prepared:", submissionData, formData);
    // alert("Handling form submission is working well so far!");

    try {
      const response = await fetch(window.wvcHandlerData.ajaxUrl, {
        method: "POST",
        body: submissionData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Handle WordPress AJAX response format
      if (result.success) {
        return result.data; // Return the actual data
      } else {
        throw new Error(result.data.message || "Form submission failed");
      }
    } catch (error) {
      console.error("Form submission error:", error);
      throw error;
    }
  }

  generateSessionId() {
    // Check if session ID already exists
    let sessionId = sessionStorage.getItem("wvc_session_id");

    if (!sessionId) {
      // Generate a new session ID
      sessionId =
          "wvc_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem("wvc_session_id", sessionId);
    }

    // console.log("Generated/Retrieved session ID:", sessionId);
    return sessionId;
  }

  get_rest_nonce() {
    return window["WVC"].wpRestNonce;
  }

  set_rest_nonce(nonce) {
    window["WVC"].wpRestNonce = nonce;
  }

  async register_user({ email, password, first_name = "", last_name = "" } = {}) {
    try {
      const homeUrl = window["WVC"].homeUrl.replace(/\/+$/, "");
      const response = await fetch(`${homeUrl}/wp-json/wvc/v1/user/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, first_name, last_name }),
      });
      const data = await response.json();
      if (response.status !== 200) {
        return { success: false, data: null, error: { code: data?.code ?? "error", message: data?.message ?? "Registration failed" } };
      }
      return { success: true, data, error: null };
    } catch {
      return { success: false, data: null, error: { code: "error", message: "Registration failed" } };
    }
  }

  async login_user(username, password, remember = false) {
    try {
      const homeUrl = window["WVC"].homeUrl.replace(/\/+$/, "");
      const response = await fetch(`${homeUrl}/wp-json/wvc/v1/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await response.json();
      if (response.status !== 200) {
        return { success: false, data: null, error: { code: data?.code ?? "error", message: data?.message ?? "Login failed" } };
      }
      if (data.rest_nonce) {
        this.set_rest_nonce(data.rest_nonce);
      }
      return { success: true, data: data.user ?? null, error: null };
    } catch {
      return { success: false, data: null, error: { code: "error", message: "Login failed" } };
    }
  }

  async logout_user() {
    const nonce = this.get_rest_nonce();
    if (!nonce) return { success: true, data: null, error: null };

    try {
      const homeUrl = window["WVC"].homeUrl.replace(/\/+$/, "");
      const response = await fetch(`${homeUrl}/wp-json/wvc/v1/user/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": nonce,
        },
        credentials: "include",
      });
      const data = await response.json();
      if (response.status !== 200) {
        return { success: false, data: null, error: { code: data?.code ?? "error", message: data?.message ?? "Logout failed" } };
      }
      return { success: true, data, error: null };
    } catch {
      return { success: false, data: null, error: { code: "error", message: "Logout failed" } };
    }
  }

  async get_logged_in_user() {
    const nonce = this.get_rest_nonce();
    if (!nonce) return { success: true, data: null, error: null };

    try {
      const homeUrl = window["WVC"].homeUrl.replace(/\/+$/, "");
      const response = await fetch(`${homeUrl}/wp-json/wvc/v1/user/me`, {
        headers: { "X-WP-Nonce": nonce },
        credentials: "include",
      });
      const data = await response.json();
      if (response.status !== 200) {
        return { success: false, data: null, error: { code: data?.code ?? "error", message: data?.message ?? "Failed to fetch user" } };
      }
      return { success: true, data, error: null };
    } catch {
      return { success: false, data: null, error: { code: "error", message: "Failed to fetch user" } };
    }
  }

  cart = {


    addToCart: async (item) => {
      console.log(item);

      // Validate input
      if (!item) {
        return {
          success: false,
          message: "Item parameter is required",
        };
      }

      const { id, quantity = 1 } = item;
      const cartProductId = Number(id);

      // Validate product_id
      if (!cartProductId || cartProductId <= 0 || Number.isNaN(cartProductId)) {
        return {
          success: false,
          message: `Invalid product id: ${id}. Must be a positive integer.`,
        };
      }

      // Validate quantity
      if (isNaN(quantity) || quantity <= 0) {
        return {
          success: false,
          message: `Invalid quantity: ${quantity}. Must be a positive integer.`,
        };
      }

      console.log("Adding to Cart:", { id: cartProductId, quantity });

      const formData = new FormData();
      formData.append("product_id", cartProductId.toString());
      formData.append("quantity", quantity.toString());
      formData.append("action", "wvc_cart_add");

      if (window.wvcHandlerData && window.wvcHandlerData.nonce) {
        formData.append("nonce", window.wvcHandlerData.nonce);
      } else {
        return {
          success: false,
          message: "wvcHandlerData or nonce not available",
        };
      }

      try {
        const response = await fetch(window.wvcHandlerData.ajaxUrl, {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        // WordPress always returns success=true in the outer wrapper
        // Check the inner success field for actual operation status
        if (result.success && result.data.success) {
          console.log("Successfully added to cart:", result.data);
          return {
            success: true,
            message: result.data.message || "Item added to cart successfully",
            data: result.data.data,
          };
        } else if (result.success && result.data.success === false) {
          // Operation failed but response was received successfully
          console.error("Add to cart failed:", result.data.message);
          return {
            success: false,
            message: result.data.message || "Add to cart failed",
          };
        } else {
          // Unexpected response format
          console.error("Unexpected response format:", result);
          return {
            success: false,
            message: "Unexpected server response",
          };
        }
      } catch (error) {
        // Handle network or parsing errors
        console.error("Add to cart error:", error);
        return {
          success: false,
          message: `Network error: ${error.message}`,
        };
      }
    },

    currentState: async () => {
      const formData = new FormData();
      formData.append("action", "wvc_cart_get");

      if (window.wvcHandlerData && window.wvcHandlerData.nonce) {
        formData.append("nonce", window.wvcHandlerData.nonce);
      }

      try {
        const response = await fetch(window.wvcHandlerData.ajaxUrl, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
          return result.data;
        } else {
          throw new Error(result.data.message || "Get cart state failed");
        }
      } catch (error) {
        console.error("Get cart state error:", error);
        return [];
      }
    },

    removeFromCart: async (id) => {
      const formData = new FormData();
      formData.append("cart_item_key", id);
      formData.append("action", "wvc_cart_remove");

      if (window.wvcHandlerData && window.wvcHandlerData.nonce) {
        formData.append("nonce", window.wvcHandlerData.nonce);
      }

      try {
        const response = await fetch(window.wvcHandlerData.ajaxUrl, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
          return result.data;
        } else {
          throw new Error(result.data.message || "Remove from cart failed");
        }
      } catch (error) {
        console.error("Remove from cart error:", error);
        throw error;
      }
    },

    // NEW: Get WooCommerce URLs
    getUrls: () => ({
      cart: window.wvcHandlerData?.woocommerce?.cartUrl || "#",
      checkout: window.wvcHandlerData?.woocommerce?.checkoutUrl || "/checkout",
      account: window.wvcHandlerData?.woocommerce?.accountUrl || "/my-account",
    }),

    // NEW: Navigate to cart
    goToCart: () => {
      const cartUrl = window.wvcHandlerData?.woocommerce?.cartUrl;
      if (cartUrl) {
        window.location.href = cartUrl;
      } else {
        console.error(
            "Cart URL not available. WooCommerce may not be configured.",
        );
      }
    },

    // NEW: Navigate to checkout
    goToCheckout: () => {
      const checkoutUrl = window.wvcHandlerData?.woocommerce?.checkoutUrl;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        console.error(
            "Checkout URL not available. WooCommerce may not be configured.",
        );
      }
    },
  };
}

window.wvcClient = new WvcClient();

// WordPress Admin Bar positioning handler
(function () {
  let processedElements = new WeakSet();

  function handleAdminBarPositioning() {
    const adminBar = document.getElementById("wpadminbar");

    if (!adminBar) {
      return;
    }

    // Check if admin bar is visible (not display: none)
    const computedStyle = window.getComputedStyle(adminBar);
    const isVisible =
        computedStyle.display !== "none" && computedStyle.visibility !== "hidden";

    if (!isVisible || !adminBar.offsetHeight) {
      return;
    }

    const adminBarHeight = adminBar.offsetHeight;

    // Find all elements with fixed/sticky positioning and top < admin bar height
    const fixedElements = document.querySelectorAll("*");
    const elementsToAdjust = [];

    fixedElements.forEach((element) => {
      // Skip the admin bar itself and already processed elements
      if (element.id === "wpadminbar" || processedElements.has(element)) {
        return;
      }

      const computedStyle = window.getComputedStyle(element);
      const position = computedStyle.position;
      const top = computedStyle.top;

      if ((position === "fixed" || position === "sticky") && top !== "auto") {
        const topValue = parseFloat(top);
        if (!isNaN(topValue) && topValue < adminBarHeight) {
          elementsToAdjust.push({
            element: element,
            originalTop: topValue,
          });
        }
      }
    });

    // Adjust elements
    elementsToAdjust.forEach((item) => {
      const newTop = item.originalTop + adminBarHeight;
      item.element.style.top = newTop + "px";
      processedElements.add(item.element);
    });
  }

  // Function to continuously monitor for new elements
  function startMonitoring() {
    // Run immediately
    handleAdminBarPositioning();

    // Start observing after 1 second to ensure initial DOM is rendered
    setTimeout(() => {
      // Use MutationObserver to watch for new elements being added
      const observer = new MutationObserver(function (mutations) {
        let shouldCheck = false;
        mutations.forEach(function (mutation) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            shouldCheck = true;
          }
        });

        if (shouldCheck) {
          // Use requestAnimationFrame to ensure DOM is fully rendered
          requestAnimationFrame(handleAdminBarPositioning);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }, 1000);

    // Also run periodically to catch any missed elements
    setInterval(handleAdminBarPositioning, 1000);
  }

  // Start monitoring when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startMonitoring);
  } else {
    startMonitoring();
  }

  // Also run on window resize in case admin bar height changes
  window.addEventListener("resize", handleAdminBarPositioning);
})();
