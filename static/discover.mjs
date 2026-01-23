import {xhr} from "./framework/templating.mjs";
import global from "./framework/global.mjs";
import {setElement} from "./framework/vesta.mjs";
import {loadServer} from "./crud.mjs";

let discoverServersCache = null;
let currentFilters = {
    search: '',
    language: '',
    tags: []
};

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

function loadDiscoverServers() {
    const { search, language, tags } = currentFilters;

    let url = 'getDiscoverableServers';
    const params = [];

    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (language) params.push(`language=${encodeURIComponent(language)}`);
    if (tags.length > 0) params.push(`tags=${encodeURIComponent(JSON.stringify(tags))}`);

    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    const onload = function() {
        try {
            const data = JSON.parse(this.responseText);
            discoverServersCache = data;
            renderDiscoverServers(data);
        } catch (e) {
            console.error('Error loading discoverable servers:', e);
        }
    };

    xhr(url, onload, "GET", false);

    // Load available tags
    loadAvailableTags();
}

function renderDiscoverServers(data) {
    const featuredList = document.getElementById('featured-servers-list');
    const allList = document.getElementById('all-servers-list');
    const featuredSection = document.getElementById('featured-servers-section');
    const noResults = document.getElementById('no-results');

    // Clear lists
    featuredList.innerHTML = '';
    allList.innerHTML = '';

    // Show/hide featured section
    if (data.featured && data.featured.length > 0) {
        featuredSection.style.display = 'block';
        data.featured.forEach(server => {
            featuredList.innerHTML += renderServerCard(server);
        });
    } else {
        featuredSection.style.display = 'none';
    }

    // Render all servers
    if (data.regular && data.regular.length > 0) {
        data.regular.forEach(server => {
            allList.innerHTML += renderServerCard(server);
        });
        noResults.style.display = 'none';
    } else if (data.featured.length === 0) {
        noResults.style.display = 'block';
    }
}

function renderServerCard(server) {
    // Parse tags if string
    let tags = server.tags || [];
    if (typeof tags === 'string') {
        try {
            tags = JSON.parse(tags);
        } catch (e) {
            tags = [];
        }
    }

    const tagsHtml = tags.length > 0
        ? '<div class="server-tags">' + tags.map(tag => `<span class="tag">${tag}</span>`).join('') + '</div>'
        : '';

    const featuredBadge = server.is_featured
        ? '<div class="featured-badge">⭐ Mis en avant</div>'
        : '';

    const icon = server.pfp
        ? `<img src="/static/attachments/${server.pfp}" alt="${server.name}">`
        : `<div class="server-placeholder">${getSlug(server.name)}</div>`;

    const joinButton = server.is_joined
        ? '<button class="btn grey" disabled>Déjà membre</button>'
        : `<button class="btn blue" onclick="joinDiscoverServer(${server.id})">Rejoindre</button>`;

    return `
        <div class="server-card" data-server-id="${server.id}">
            <div class="server-card-header">
                ${featuredBadge}
            </div>
            <div class="server-card-icon">
                ${icon}
            </div>
            <div class="server-card-info">
                <h3>${server.name}</h3>
                <p class="server-description">${server.description || 'Aucune description'}</p>
                <div class="server-stats">
                    <span class="stat">
                        <img src="/static/icons/material/people.svg" alt="Members" class="icon-small" style="width: 16px; height: 16px;">
                        ${server.member_count || 0} membres
                    </span>
                    <span class="stat language-badge">${server.language || 'en'}</span>
                </div>
                ${tagsHtml}
            </div>
            <div class="server-card-actions">
                ${joinButton}
            </div>
        </div>
    `;
}

function filterDiscoverServers() {
    const searchInput = document.getElementById('discover-search');
    const languageSelect = document.getElementById('discover-language');

    currentFilters.search = searchInput ? searchInput.value : '';
    currentFilters.language = languageSelect ? languageSelect.value : '';

    loadDiscoverServers();
}
window.filterDiscoverServers = filterDiscoverServers;

function joinDiscoverServer(serverId) {
    const onload = function() {
        try {
            const response = JSON.parse(this.responseText);
            if (response.success) {
                // Reload server list
                const server = discoverServersCache.regular.find(s => s.id === serverId) ||
                              discoverServersCache.featured.find(s => s.id === serverId);

                if (server) {
                    // Add to user's servers
                    setElement(`global.servers[${serverId}]`, server);

                    // Update button
                    const card = document.querySelector(`[data-server-id="${serverId}"]`);
                    if (card) {
                        const actionsDiv = card.querySelector('.server-card-actions');
                        if (actionsDiv) {
                            actionsDiv.innerHTML = '<button class="btn grey" disabled>Déjà membre</button>';
                        }
                    }

                    // Show notification
                    console.log(`Successfully joined server: ${server.name}`);
                }
            }
        } catch (e) {
            console.error('Error joining server:', e);
        }
    };

    const onerror = function() {
        console.error('Failed to join server');
        alert('Impossible de rejoindre ce serveur. Veuillez réessayer.');
    };

    const request = new XMLHttpRequest();
    request.open('POST', `joinCommunityServer?server_id=${serverId}`, true);
    request.onload = onload;
    request.onerror = onerror;
    request.send();
}
window.joinDiscoverServer = joinDiscoverServer;

function loadAvailableTags() {
    const onload = function() {
        try {
            const tags = JSON.parse(this.responseText);
            renderTagsFilter(tags);
        } catch (e) {
            console.error('Error loading tags:', e);
        }
    };

    xhr('getAvailableTags', onload, "GET", false);
}

function renderTagsFilter(tags) {
    const container = document.getElementById('discover-tags-filter');
    if (!container || tags.length === 0) return;

    container.innerHTML = '<div class="tags-filter-label">Filtrer par tags:</div>';
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tags-filter-options';

    tags.forEach(tag => {
        const tagButton = document.createElement('button');
        tagButton.className = 'tag-filter-btn';
        tagButton.textContent = tag;
        tagButton.onclick = () => toggleTagFilter(tag, tagButton);
        tagsContainer.appendChild(tagButton);
    });

    container.appendChild(tagsContainer);
}

function toggleTagFilter(tag, button) {
    const index = currentFilters.tags.indexOf(tag);

    if (index > -1) {
        // Remove tag
        currentFilters.tags.splice(index, 1);
        button.classList.remove('active');
    } else {
        // Add tag
        currentFilters.tags.push(tag);
        button.classList.add('active');
    }

    loadDiscoverServers();
}

function getSlug(name) {
    const words = name.split(' ');
    let i = 0;
    let slug = '';
    while (i < words.length && i < 2) {
        slug = slug + words[i][0];
        i++;
    }
    return slug.toUpperCase();
}

export { openDiscoverServers, closeDiscoverServers, joinDiscoverServer };
