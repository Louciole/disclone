import {xhr} from "./framework/templating.mjs";
import {setElement} from "./framework/vesta.mjs";

// Initialize discover state
if (!global.discover) {
    setElement('global.discover', {
        search: { text: '', languages: [], tags: [] },
        servers: { featured: [], regular: [] }
    });
}

function openDiscoverServers() {
    const menu = document.getElementById('discover-servers-menu');
    if (menu) {
        menu.style.display = 'flex';
        loadDiscoverServers();
    }
}
window.openDiscoverServers = openDiscoverServers;

function closeDiscoverServers() {
    const menu = document.getElementById('discover-servers-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}
window.closeDiscoverServers = closeDiscoverServers;

// HTML escape utility function to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Render active filter badges
function renderActiveBadges() {
    const container = document.getElementById('discover-active-filters');
    if (!container) return;

    const search = global.discover?.search || { text: '', languages: [], tags: [] };

    if (search.languages.length === 0 && search.tags.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = '<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">';

    // Language badges (escaped to prevent XSS)
    search.languages.forEach(lang => {
        const escapedLang = escapeHtml(lang);
        const label = window.getLanguageLabel ? window.getLanguageLabel(escapedLang) : escapedLang;
        html += `<button class="filter-badge lang-badge" onclick="removeLanguageFromSearch('${escapedLang}')" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.8rem; background: var(--blue); color: white; border: none; border-radius: 16px; cursor: pointer; font-size: 0.9rem;">
            ${escapeHtml(label)} ×
        </button>`;
    });

    // Tag badges (escaped to prevent XSS)
    search.tags.forEach(tag => {
        const escapedTag = escapeHtml(tag);
        html += `<button class="filter-badge tag-badge" onclick="removeTagFromSearch('${escapedTag}')" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.8rem; background: var(--green); color: white; border: none; border-radius: 16px; cursor: pointer; font-size: 0.9rem;">
            🏷️ ${escapedTag} ×
        </button>`;
    });

    html += '</div>';
    container.innerHTML = html;
}

// Render server cards
function renderServers() {
    const container = document.getElementById('discover-content');
    if (!container) return;

    const data = global.discover?.servers || { featured: [], regular: [] };

    console.log('🔍 Rendering servers');
    console.log('  - featured:', data.featured?.length || 0);
    console.log('  - regular:', data.regular?.length || 0);

    let html = '';

    // Featured servers section
    if (data.featured && data.featured.length > 0) {
        console.log('  ⭐ Rendering featured servers...');
        html += '<div class="discover-section">';
        html += '<h2>Serveurs mis en avant</h2>';
        html += '<div class="servers-grid">';
        html += fillWith('discover-server-card', data.featured);
        html += '</div>';
        html += '</div>';
    }

    // Regular servers section
    if (data.regular && data.regular.length > 0) {
        console.log('  📋 Rendering regular servers...');
        html += '<div class="discover-section">';
        html += '<h2>Tous les serveurs</h2>';
        html += '<div class="servers-grid">';
        html += fillWith('discover-server-card', data.regular);
        html += '</div>';
        html += '</div>';
    }

    // No results message
    if (data.featured.length === 0 && data.regular.length === 0) {
        console.log('  ℹ️ No servers found');
        html += '<div style="text-align: center; padding: 3rem; color: var(--text2); font-size: 1.1rem;">';
        html += '<p>Aucun serveur trouvé avec ces critères de recherche.</p>';
        html += '</div>';
    }

    console.log('  ✅ Setting HTML, length:', html.length);
    container.innerHTML = html;
}

// Parse search query with lang: and tag: syntax
function parseSearchQuery(query) {
    const result = {
        text: '',
        languages: [],
        tags: []
    };

    if (!query) return result;

    // Extract lang:...
    const langRegex = /lang:([a-z,]+)/gi;
    let match;
    while ((match = langRegex.exec(query)) !== null) {
        const langs = match[1].split(',').map(l => l.trim()).filter(l => l);
        result.languages.push(...langs);
    }
    query = query.replace(langRegex, '').trim();

    // Extract tag:...
    const tagRegex = /tag:([a-z0-9,]+)/gi;
    while ((match = tagRegex.exec(query)) !== null) {
        const tags = match[1].split(',').map(t => t.trim()).filter(t => t);
        result.tags.push(...tags);
    }
    query = query.replace(tagRegex, '').trim();

    result.text = query;
    return result;
}
window.parseSearchQuery = parseSearchQuery;

// Build search query from state
function buildSearchQuery() {
    const search = global.discover?.search || { text: '', languages: [], tags: [] };
    let query = search.text || '';

    if (search.languages && search.languages.length > 0) {
        query += ` lang:${search.languages.join(',')}`;
    }

    if (search.tags && search.tags.length > 0) {
        query += ` tag:${search.tags.join(',')}`;
    }

    return query.trim();
}
window.buildSearchQuery = buildSearchQuery;

// Handle smart search input
function handleSmartSearch(event) {
    const query = event.target.value;
    const parsed = parseSearchQuery(query);

    // Update state
    setElement('global.discover.search', parsed);

    // Update UI
    renderActiveBadges();

    // Reload servers with new filters
    loadDiscoverServers();
}
window.handleSmartSearch = handleSmartSearch;

// Remove language from search
function removeLanguageFromSearch(lang) {
    const search = global.discover?.search || { text: '', languages: [], tags: [] };
    const index = search.languages.indexOf(lang);
    if (index > -1) {
        search.languages.splice(index, 1);
    }
    setElement('global.discover.search', search);

    // Update input value
    const input = document.getElementById('discover-search-smart');
    if (input) {
        input.value = buildSearchQuery();
    }

    // Update UI
    renderActiveBadges();
    loadDiscoverServers();
}
window.removeLanguageFromSearch = removeLanguageFromSearch;

// Remove tag from search
function removeTagFromSearch(tag) {
    const search = global.discover?.search || { text: '', languages: [], tags: [] };
    const index = search.tags.indexOf(tag);
    if (index > -1) {
        search.tags.splice(index, 1);
    }
    setElement('global.discover.search', search);

    // Update input value
    const input = document.getElementById('discover-search-smart');
    if (input) {
        input.value = buildSearchQuery();
    }

    // Update UI
    renderActiveBadges();
    loadDiscoverServers();
}
window.removeTagFromSearch = removeTagFromSearch;

function loadDiscoverServers() {
    const search = global.discover?.search || { text: '', languages: [], tags: [] };

    let url = 'getDiscoverableServers';
    const params = [];

    if (search.text) params.push(`search=${encodeURIComponent(search.text)}`);
    if (search.languages.length > 0) params.push(`languages=${encodeURIComponent(JSON.stringify(search.languages))}`);
    if (search.tags.length > 0) params.push(`tags=${encodeURIComponent(JSON.stringify(search.tags))}`);

    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    const onload = function() {
        try {
            const data = JSON.parse(this.responseText);
            console.log('📡 Backend response:', data);
            // Update state
            setElement('global.discover.servers', data);
            // Render servers
            renderServers();
        } catch (e) {
            console.error('Error loading discoverable servers:', e);
        }
    };

    xhr(url, onload, "GET", false);
}

function toggleServerFeatured(serverId, featured) {
    const onload = function() {
        try {
            const response = JSON.parse(this.responseText);
            if (response.success) {
                // Reload the server list to reflect changes
                loadDiscoverServers();
            }
        } catch (e) {
            console.error('Error toggling featured status:', e);
            alert('Erreur lors de la mise à jour du serveur.');
        }
    };

    const onerror = function() {
        console.error('Failed to toggle featured status');
        alert('Erreur: Vous devez être administrateur pour mettre en avant des serveurs.');
    };

    xhr(`setServerFeatured?server_id=${serverId}&featured=${featured}`, onload, "POST", false, onerror);
}
window.toggleServerFeatured = toggleServerFeatured;

function joinDiscoverServer(serverId) {
    const onload = function() {
        try {
            const response = JSON.parse(this.responseText);
            if (response.success) {
                // Reload server list to update join status
                loadDiscoverServers();

                // Show notification
                console.log(`Successfully joined server ID: ${serverId}`);
            }
        } catch (e) {
            console.error('Error joining server:', e);
            alert('Erreur lors du traitement de la réponse.');
        }
    };

    const onerror = function() {
        console.error('Failed to join server');
        alert('Impossible de rejoindre ce serveur. Veuillez réessayer.');
    };

    xhr(`joinCommunityServer?server_id=${serverId}`, onload, "POST", false, onerror);
}
window.joinDiscoverServer = joinDiscoverServer;


export { openDiscoverServers, closeDiscoverServers, joinDiscoverServer };
