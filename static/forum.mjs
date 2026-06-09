import global from "./framework/global.mjs"
import {setElement} from "./framework/vesta.mjs"
import {createForumPost, editForumPost, editForumTags, editForumSettings, loadForum} from "./crud.mjs"

function esc(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;") }
window.escHtml = esc

/** Toolbar, guidelines, and tag admin — fixed section above the post list. */
export function renderForumToolbar(forumId){
    const forum = global.forums?.[forumId]
    if (!forum) return ""

    const tags = forum.available_tags || []
    const tagChips = tags.map(t =>
        '<div class="forum-tag-chip'+(String(forum.tagFilter)===String(t.id)?' selected':'')+'" '+
        'style="--tag-color:'+esc(t.color||'#5865F2')+'" '+
        'onclick="toggleForumTagFilter('+forumId+','+JSON.stringify(t.id)+')">'+esc(t.name)+'</div>'
    ).join("")

    const layout = forum.layout || "list"
    const sort = forum.sort || "activity"

    const toolbar =
        '<div class="forum-toolbar">'+
            '<div class="forum-tag-filters">'+tagChips+'</div>'+
            '<div class="forum-controls">'+
                '<select class="forum-sort" onchange="setForumSort('+forumId+',this.value)">'+
                    '<option value="activity"'+(sort==="activity"?" selected":"")+'>Recent activity</option>'+
                    '<option value="newest"'+(sort==="newest"?" selected":"")+'>Newest</option>'+
                    '<option value="oldest"'+(sort==="oldest"?" selected":"")+'>Oldest</option>'+
                '</select>'+
                '<div class="forum-layout-toggle">'+
                    '<div class="forum-layout-btn'+(layout==="list"?" selected":"")+'" onclick="setForumLayout('+forumId+',\'list\')" title="List view">&#9776;</div>'+
                    '<div class="forum-layout-btn'+(layout==="gallery"?" selected":"")+'" onclick="setForumLayout('+forumId+',\'gallery\')" title="Gallery view">&#9783;</div>'+
                '</div>'+
            '</div>'+
        '</div>'

    const guidelinesHtml = forum.guidelines
        ? '<div class="forum-guidelines">'+esc(forum.guidelines)+'</div>'
        : ""

    return toolbar + guidelinesHtml + renderTagAdmin(forumId)
}
window.renderForumToolbar = renderForumToolbar

/** Post list content rendered inside the static scrollable container in the template. */
export function renderForumPosts(forumId){
    const forum = global.forums?.[forumId]
    if (!forum) return ""
    const layout = forum.layout || "list"
    const posts = getForumPosts(forumId)
    if (!posts.length){
        return '<div class="forum-empty"><p>No posts yet. Create the first one!</p></div>'
    }
    return '<div class="forum-'+layout+'">'+fillWith('forum-post-card', posts.map(p => ({...p, forumId})))+'</div>'
}
window.renderForumPosts = renderForumPosts

/** Admin-only inline tag manager, shown collapsed under the toolbar. */
function renderTagAdmin(forumId){
    if (!(typeof checkServRights === "function" && checkServRights("edit"))) return ""
    const forum = global.forums?.[forumId]
    const tags = forum?.available_tags || []
    const rows = tags.map(t =>
        '<div class="forum-tag-admin-row">'+
            '<span class="forum-tag-chip small" style="--tag-color:'+esc(t.color||'#5865F2')+'">'+esc(t.name)+'</span>'+
            '<img class="icon" src="/static/icons/material/trash.svg" style="width:0.9rem;cursor:pointer" onclick="removeForumTag('+forumId+','+JSON.stringify(t.id)+')"/>'+
        '</div>'
    ).join("")
    return '<details class="forum-tag-admin"><summary style="cursor:pointer;color:var(--text2);padding:0.4rem 1rem;font-size:0.85rem">Manage forum</summary>'+
        '<div style="padding:0.4rem 1rem">'+rows+
            '<div class="forum-tag-admin-row">'+
                '<input id="new-forum-tag-name" class="dark" type="text" placeholder="Tag name" style="max-width:160px"/>'+
                '<input id="new-forum-tag-color" type="color" value="#5865F2"/>'+
                '<div class="btn blue" style="padding:0.3rem 0.7rem" onclick="addForumTag('+forumId+')">Add tag</div>'+
            '</div>'+
            '<div class="forum-tag-admin-row" style="flex-direction:column;align-items:flex-start;gap:0.3rem;margin-top:0.6rem">'+
                '<label style="color:var(--text2);font-size:0.85rem">Post guidelines</label>'+
                '<textarea id="forum-guidelines-input" class="dark" rows="3" style="width:100%;resize:vertical;box-sizing:border-box">'+esc(forum?.guidelines || '')+'</textarea>'+
                '<div class="btn blue" style="padding:0.3rem 0.7rem" onclick="saveForumGuidelines('+forumId+')">Save guidelines</div>'+
            '</div>'+
        '</div></details>'
}

/** Render a post's tag chips (small, read-only) given the parent forum's tag definitions. */
export function renderPostTags(forumId, tagIds){
    const forum = global.forums?.[forumId]
    if (!forum || !tagIds || !tagIds.length) return ""
    return (tagIds || []).map(id => {
        const t = (forum.available_tags || []).find(tt => String(tt.id) === String(id))
        if (!t) return ""
        return '<span class="forum-tag-chip small" style="--tag-color:'+esc(t.color||'#5865F2')+'">'+esc(t.name)+'</span>'
    }).join("")
}
window.renderPostTags = renderPostTags

/** Returns the posts of the active forum, filtered by tag and sorted by the current sort mode. */
export function getForumPosts(forumId){
    const forum = global.forums?.[forumId]
    if (!forum) return []
    let posts = [...(forum.posts || [])]

    if (forum.tagFilter != null){
        posts = posts.filter(p => (p.tags || []).map(String).includes(String(forum.tagFilter)))
    }

    const sort = forum.sort || "activity"
    posts.sort((a, b) => {
        // Pinned posts always float to the top
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        if (sort === "newest") return new Date(b.created_at) - new Date(a.created_at)
        if (sort === "oldest") return new Date(a.created_at) - new Date(b.created_at)
        return new Date(b.last_activity) - new Date(a.last_activity) // activity (default)
    })
    return posts
}
window.getForumPosts = getForumPosts

/** Look up a tag descriptor by id within a forum's available_tags. */
export function getForumTag(forumId, tagId){
    const forum = global.forums?.[forumId]
    return (forum?.available_tags || []).find(t => String(t.id) === String(tagId))
}
window.getForumTag = getForumTag

export function setForumLayout(forumId, layout){
    if (!global.forums?.[forumId]) return
    global.forums[forumId].layout = layout
    setElement("global.forums["+forumId+"]", global.forums[forumId])
    editForumSettings(forumId, "default_layout", layout)
}
window.setForumLayout = setForumLayout

export function setForumSort(forumId, sort){
    if (!global.forums?.[forumId]) return
    global.forums[forumId].sort = sort
    setElement("global.forums["+forumId+"]", global.forums[forumId])
    editForumSettings(forumId, "default_sort", sort)
}
window.setForumSort = setForumSort

export function toggleForumTagFilter(forumId, tagId){
    if (!global.forums?.[forumId]) return
    const current = global.forums[forumId].tagFilter
    global.forums[forumId].tagFilter = (String(current) === String(tagId)) ? null : tagId
    setElement("global.forums["+forumId+"]", global.forums[forumId])
}
window.toggleForumTagFilter = toggleForumTagFilter

/* ---- Create post modal ---- */

export function openCreatePostModal(forumId){
    const modal = document.getElementById("create-forum-post")
    if (!modal) return
    modal.dataset.forumId = forumId
    modal.querySelector("[data-post-title]").value = ""
    modal.querySelector("[data-post-content]").value = ""

    // Populate selectable tag chips from the forum's available tags
    const container = modal.querySelector("[data-tag-options-container]")
    const tags = global.forums?.[forumId]?.available_tags || []
    container.innerHTML = tags.map(t =>
        '<div class="forum-tag-chip" data-tag-option="'+t.id+'" '+
        'style="--tag-color:'+esc(t.color||'#5865F2')+'" '+
        'onclick="toggleNewPostTag(this)">'+esc(t.name)+'</div>'
    ).join("")

    modal.style.display = "flex"
}
window.openCreatePostModal = openCreatePostModal

export function toggleNewPostTag(el){
    el.classList.toggle("selected")
}
window.toggleNewPostTag = toggleNewPostTag

export function submitForumPost(){
    const modal = document.getElementById("create-forum-post")
    const forumId = parseInt(modal.dataset.forumId)
    const title = modal.querySelector("[data-post-title]").value.trim()
    const content = modal.querySelector("[data-post-content]").value.trim()
    if (!title) return
    const tags = [...modal.querySelectorAll("[data-tag-option].selected")].map(el => el.dataset.tagOption)

    try {
        const post = createForumPost(forumId, title, content, tags)
        modal.style.display = "none"
        if (post) window.goToForumPost(post.id)
    } catch(e) {
        console.error("Failed to create post:", e)
    }
}
window.submitForumPost = submitForumPost

/* ---- Post moderation (from the open post view) ---- */

export function togglePinPost(postId){
    const post = global.convs?.[postId]
    if (!post) return
    const res = editForumPost(postId, post.pinned ? "unpin" : "pin")
    post.pinned = res.pinned
    _syncPostInList(post)
    setElement("global.convs["+postId+"]", post)
}
window.togglePinPost = togglePinPost

export function toggleLockPost(postId){
    const post = global.convs?.[postId]
    if (!post) return
    const res = editForumPost(postId, post.locked ? "unlock" : "lock")
    post.locked = res.locked
    _syncPostInList(post)
    setElement("global.convs["+postId+"]", post)
}
window.toggleLockPost = toggleLockPost

export function deleteForumPost(postId){
    const post = global.convs?.[postId]
    const forumId = post?.forum
    editForumPost(postId, "delete")
    if (forumId != null && global.forums?.[forumId]){
        global.forums[forumId].posts = global.forums[forumId].posts.filter(p => p.id != postId)
        setElement("global.forums["+forumId+"].posts", global.forums[forumId].posts)
        window.goToForumChannel(forumId)
    }
}
window.deleteForumPost = deleteForumPost

function _syncPostInList(post){
    const forum = global.forums?.[post.forum]
    if (!forum) return
    const listed = forum.posts.find(p => p.id == post.id)
    if (listed){
        listed.pinned = post.pinned
        listed.locked = post.locked
        setElement("global.forums["+post.forum+"].posts", forum.posts)
    }
}

/* ---- Tag administration (forum settings) ---- */

export function addForumTag(forumId){
    const nameInput = document.getElementById("new-forum-tag-name")
    const colorInput = document.getElementById("new-forum-tag-color")
    const name = nameInput?.value.trim()
    if (!name) return
    editForumTags(forumId, "add", {name, color: colorInput?.value || "#5865F2"})
    if (nameInput) nameInput.value = ""
}
window.addForumTag = addForumTag

export function removeForumTag(forumId, tagId){
    editForumTags(forumId, "remove", null, tagId)
}
window.removeForumTag = removeForumTag

export function saveForumGuidelines(forumId){
    const input = document.getElementById("forum-guidelines-input")
    const value = input?.value ?? ""
    editForumSettings(forumId, "guidelines", value)
    if (global.forums?.[forumId]) {
        global.forums[forumId].guidelines = value
        setElement("global.forums["+forumId+"]", global.forums[forumId])
    }
}
window.saveForumGuidelines = saveForumGuidelines
