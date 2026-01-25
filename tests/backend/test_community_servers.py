"""
Tests for the Community Servers / Discover Servers feature.

This test suite covers:
- Making a server discoverable
- Editing server community settings (tags, languages, description)
- Discovering servers with filters
- Joining community servers
- Admin-only featured server functionality
"""

import json
from tests.backend.backend import (
    TEST_SERVER_URL,
    with_test_user,
    with_test_users
)


@with_test_user("community_server")
def test_create_and_make_community_server(session):
    """Test creating a server and making it a community server"""
    # Create a regular server
    response = session.post(f'{TEST_SERVER_URL}/createServer')
    assert response.status_code == 200, f"Failed to create server: {response.text}"
    server_id = int(response.text.strip('"'))

    # Make it a community server
    response = session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={
            'property': 'is_community',
            'id': server_id,
            'value': 'true'
        }
    )
    assert response.status_code == 200, f"Failed to make server community: {response.text}"

    return ("Server successfully created and made community", True)


@with_test_user("community_settings")
def test_edit_community_server_settings(session):
    """Test editing community server settings (description, tags, languages)"""
    # Create and make community server
    response = session.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'is_community', 'id': server_id, 'value': 'true'}
    )

    # Set description
    response = session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={
            'property': 'description',
            'id': server_id,
            'value': 'A test community server for gaming'
        }
    )
    assert response.status_code == 200, "Failed to set description"

    # Set languages (multiple)
    languages = json.dumps(['en', 'fr'])
    response = session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={
            'property': 'languages',
            'id': server_id,
            'value': languages
        }
    )
    assert response.status_code == 200, "Failed to set languages"

    # Set tags
    tags = json.dumps(['gaming', 'friendly', 'english'])
    response = session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={
            'property': 'tags',
            'id': server_id,
            'value': tags
        }
    )
    assert response.status_code == 200, "Failed to set tags"

    return ("Community server settings edited successfully", True)


@with_test_user("discover_no_filter")
def test_discover_servers_no_filters(session):
    """Test discovering servers without filters"""
    response = session.get(f'{TEST_SERVER_URL}/getDiscoverableServers')
    assert response.status_code == 200, "Failed to get discoverable servers"

    data = json.loads(response.text)
    assert 'featured' in data, "Missing 'featured' key in response"
    assert 'regular' in data, "Missing 'regular' key in response"
    assert isinstance(data['featured'], list), "'featured' should be a list"
    assert isinstance(data['regular'], list), "'regular' should be a list"

    return ("Successfully discovered servers without filters", True)


@with_test_user("discover_search")
def test_discover_servers_with_search(session):
    """Test discovering servers with search filter"""
    # First create a community server to search for
    response = session.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'is_community', 'id': server_id, 'value': 'true'}
    )

    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'description', 'id': server_id, 'value': 'gaming community'}
    )

    # Now search for it
    response = session.get(
        f'{TEST_SERVER_URL}/getDiscoverableServers',
        params={'search': 'gaming'}
    )
    assert response.status_code == 200, "Search request failed"

    data = json.loads(response.text)
    all_servers = data['featured'] + data['regular']

    # Check that results contain 'gaming' in name or description
    for server in all_servers:
        name_match = 'gaming' in server.get('name', '').lower()
        desc_match = 'gaming' in server.get('description', '').lower()
        assert name_match or desc_match, f"Server {server.get('name')} doesn't match search term"

    return ("Search filter works correctly", True)


@with_test_user("discover_language")
def test_discover_servers_with_language_filter(session):
    """Test discovering servers filtered by language"""
    # Create a server with specific language
    response = session.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'is_community', 'id': server_id, 'value': 'true'}
    )

    languages = json.dumps(['fr'])
    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'languages', 'id': server_id, 'value': languages}
    )

    # Filter by French language
    response = session.get(
        f'{TEST_SERVER_URL}/getDiscoverableServers',
        params={'languages': json.dumps(['fr'])}
    )
    assert response.status_code == 200, "Language filter request failed"

    data = json.loads(response.text)
    all_servers = data['featured'] + data['regular']

    # Check that all servers have 'fr' in their languages
    for server in all_servers:
        server_languages = server.get('languages', [])
        if isinstance(server_languages, str):
            server_languages = json.loads(server_languages)
        assert 'fr' in server_languages, f"Server {server.get('name')} doesn't have French language"

    return ("Language filter works correctly", True)


@with_test_user("discover_tags")
def test_discover_servers_with_tags_filter(session):
    """Test discovering servers filtered by tags"""
    # Create a server with specific tags
    response = session.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'is_community', 'id': server_id, 'value': 'true'}
    )

    tags = json.dumps(['gaming', 'friendly'])
    session.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'tags', 'id': server_id, 'value': tags}
    )

    # Filter by gaming tag
    response = session.get(
        f'{TEST_SERVER_URL}/getDiscoverableServers',
        params={'tags': json.dumps(['gaming'])}
    )
    assert response.status_code == 200, "Tags filter request failed"

    data = json.loads(response.text)
    all_servers = data['featured'] + data['regular']

    for server in all_servers:
        server_tags = server.get('tags', [])
        if isinstance(server_tags, str):
            server_tags = json.loads(server_tags)
        assert 'gaming' in server_tags, f"Server {server.get('name')} doesn't have 'gaming' tag"

    return ("Tags filter works correctly", True)


@with_test_user("available_tags")
def test_get_available_tags(session):
    """Test getting all available tags"""
    response = session.get(f'{TEST_SERVER_URL}/getAvailableTags')
    assert response.status_code == 200, "Failed to get available tags"

    tags = json.loads(response.text)
    assert isinstance(tags, list), "Tags should be a list"
    # Tags should be sorted
    assert tags == sorted(tags), "Tags should be sorted alphabetically"

    return ("Available tags retrieved successfully", True)


@with_test_users(2)
def test_join_community_server(sessions):
    """Test joining a community server"""
    session1, session2 = sessions

    # User 1 creates a community server
    response = session1.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    session1.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'is_community', 'id': server_id, 'value': 'true'}
    )

    # User 2 joins the server
    response = session2.post(
        f'{TEST_SERVER_URL}/joinCommunityServer',
        params={'server_id': server_id}
    )
    assert response.status_code == 200, f"Failed to join server: {response.text}"

    data = json.loads(response.text)
    assert data.get('success') is True, "Join response should indicate success"
    assert data.get('server_id') == server_id, "Server ID should match"

    return ("User successfully joined community server", True)


@with_test_users(2)
def test_cannot_join_non_community_server(sessions):
    """Test that non-community servers cannot be joined via joinCommunityServer"""
    session1, session2 = sessions

    # User 1 creates a private server (not community)
    response = session1.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    # User 2 tries to join (should fail)
    response = session2.post(
        f'{TEST_SERVER_URL}/joinCommunityServer',
        params={'server_id': server_id}
    )
    assert response.status_code == 403, "Should not be able to join non-community server"

    return ("Correctly prevented joining non-community server", True)


@with_test_users(2)
def test_cannot_join_same_server_twice(sessions):
    """Test that joining the same server twice returns an error"""
    session1, session2 = sessions

    # User 1 creates a community server
    response = session1.post(f'{TEST_SERVER_URL}/createServer')
    server_id = int(response.text.strip('"'))

    session1.post(
        f'{TEST_SERVER_URL}/editServer',
        params={'property': 'is_community', 'id': server_id, 'value': 'true'}
    )

    # User 2 joins the server
    session2.post(
        f'{TEST_SERVER_URL}/joinCommunityServer',
        params={'server_id': server_id}
    )

    # User 2 tries to join again
    response = session2.post(
        f'{TEST_SERVER_URL}/joinCommunityServer',
        params={'server_id': server_id}
    )
    assert response.status_code == 400, "Should not be able to join same server twice"

    return ("Correctly prevented joining same server twice", True)


def run():
    """Run all community servers tests"""
    results = []

    results.append(("Create and Make Community Server", test_create_and_make_community_server()))
    results.append(("Edit Community Server Settings", test_edit_community_server_settings()))
    results.append(("Discover Servers No Filters", test_discover_servers_no_filters()))
    results.append(("Discover Servers With Search", test_discover_servers_with_search()))
    results.append(("Discover Servers With Language Filter", test_discover_servers_with_language_filter()))
    results.append(("Discover Servers With Tags Filter", test_discover_servers_with_tags_filter()))
    results.append(("Get Available Tags", test_get_available_tags()))
    results.append(("Join Community Server", test_join_community_server()))
    results.append(("Cannot Join Non-Community Server", test_cannot_join_non_community_server()))
    results.append(("Cannot Join Same Server Twice", test_cannot_join_same_server_twice()))

    return results

