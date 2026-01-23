"""
Tests for the Community Servers / Discover Servers feature.

This test suite covers:
- Making a server discoverable
- Editing server community settings (tags, language, description)
- Discovering servers with filters
- Joining community servers
- Admin-only featured server functionality
"""

import json
import requests
import pytest

TEST_SERVER_URL = "http://localhost:8000"


class TestCommunityServers:
    """Test suite for community servers feature"""

    def setup_method(self):
        """Setup test session"""
        self.session = requests.Session()
        # TODO: Add authentication setup here

    def test_create_and_make_community_server(self):
        """Test creating a server and making it a community server"""
        # Create a regular server
        response = self.session.post(f'{TEST_SERVER_URL}/createServer')
        assert response.status_code == 200
        server_id = int(response.text.strip('"'))

        # Make it a community server
        response = self.session.post(
            f'{TEST_SERVER_URL}/editServer',
            params={
                'property': 'is_community',
                'id': server_id,
                'value': 'true'
            }
        )
        assert response.status_code == 200

    def test_edit_community_server_settings(self):
        """Test editing community server settings (description, tags, language)"""
        # Create and make community server
        response = self.session.post(f'{TEST_SERVER_URL}/createServer')
        server_id = int(response.text.strip('"'))

        self.session.post(
            f'{TEST_SERVER_URL}/editServer',
            params={'property': 'is_community', 'id': server_id, 'value': 'true'}
        )

        # Set description
        response = self.session.post(
            f'{TEST_SERVER_URL}/editServer',
            params={
                'property': 'description',
                'id': server_id,
                'value': 'A test community server for gaming'
            }
        )
        assert response.status_code == 200

        # Set language
        response = self.session.post(
            f'{TEST_SERVER_URL}/editServer',
            params={
                'property': 'language',
                'id': server_id,
                'value': 'en'
            }
        )
        assert response.status_code == 200

        # Set tags
        tags = json.dumps(['gaming', 'friendly', 'english'])
        response = self.session.post(
            f'{TEST_SERVER_URL}/editServer',
            params={
                'property': 'tags',
                'id': server_id,
                'value': tags
            }
        )
        assert response.status_code == 200

    def test_discover_servers_no_filters(self):
        """Test discovering servers without filters"""
        response = self.session.get(f'{TEST_SERVER_URL}/getDiscoverableServers')
        assert response.status_code == 200

        data = json.loads(response.text)
        assert 'featured' in data
        assert 'regular' in data
        assert isinstance(data['featured'], list)
        assert isinstance(data['regular'], list)

    def test_discover_servers_with_search(self):
        """Test discovering servers with search filter"""
        response = self.session.get(
            f'{TEST_SERVER_URL}/getDiscoverableServers',
            params={'search': 'gaming'}
        )
        assert response.status_code == 200

        data = json.loads(response.text)
        # All results should contain 'gaming' in name or description
        all_servers = data['featured'] + data['regular']
        for server in all_servers:
            assert ('gaming' in server.get('name', '').lower() or
                   'gaming' in server.get('description', '').lower())

    def test_discover_servers_with_language_filter(self):
        """Test discovering servers filtered by language"""
        response = self.session.get(
            f'{TEST_SERVER_URL}/getDiscoverableServers',
            params={'language': 'fr'}
        )
        assert response.status_code == 200

        data = json.loads(response.text)
        all_servers = data['featured'] + data['regular']
        for server in all_servers:
            assert server.get('language') == 'fr'

    def test_discover_servers_with_tags_filter(self):
        """Test discovering servers filtered by tags"""
        tags = json.dumps(['gaming'])
        response = self.session.get(
            f'{TEST_SERVER_URL}/getDiscoverableServers',
            params={'tags': tags}
        )
        assert response.status_code == 200

        data = json.loads(response.text)
        all_servers = data['featured'] + data['regular']
        for server in all_servers:
            server_tags = server.get('tags', [])
            if isinstance(server_tags, str):
                server_tags = json.loads(server_tags)
            assert 'gaming' in server_tags

    def test_get_available_tags(self):
        """Test getting all available tags"""
        response = self.session.get(f'{TEST_SERVER_URL}/getAvailableTags')
        assert response.status_code == 200

        tags = json.loads(response.text)
        assert isinstance(tags, list)
        # Tags should be sorted
        assert tags == sorted(tags)

    def test_join_community_server(self):
        """Test joining a community server"""
        # First create a community server with another user
        session2 = requests.Session()
        # TODO: Authenticate as different user

        response = session2.post(f'{TEST_SERVER_URL}/createServer')
        server_id = int(response.text.strip('"'))

        session2.post(
            f'{TEST_SERVER_URL}/editServer',
            params={'property': 'is_community', 'id': server_id, 'value': 'true'}
        )

        # Now join with first user
        response = self.session.post(
            f'{TEST_SERVER_URL}/joinCommunityServer',
            params={'server_id': server_id}
        )
        assert response.status_code == 200

        data = json.loads(response.text)
        assert data['success'] is True
        assert data['server_id'] == server_id

    def test_cannot_join_non_community_server(self):
        """Test that non-community servers cannot be joined via joinCommunityServer"""
        # Create a private server
        session2 = requests.Session()
        # TODO: Authenticate as different user

        response = session2.post(f'{TEST_SERVER_URL}/createServer')
        server_id = int(response.text.strip('"'))
        # Don't make it a community server

        # Try to join
        response = self.session.post(
            f'{TEST_SERVER_URL}/joinCommunityServer',
            params={'server_id': server_id}
        )
        assert response.status_code == 403

    def test_cannot_join_same_server_twice(self):
        """Test that joining the same server twice returns an error"""
        # Create and join a community server
        session2 = requests.Session()
        # TODO: Authenticate as different user

        response = session2.post(f'{TEST_SERVER_URL}/createServer')
        server_id = int(response.text.strip('"'))

        session2.post(
            f'{TEST_SERVER_URL}/editServer',
            params={'property': 'is_community', 'id': server_id, 'value': 'true'}
        )

        # Join first time
        self.session.post(
            f'{TEST_SERVER_URL}/joinCommunityServer',
            params={'server_id': server_id}
        )

        # Try to join again
        response = self.session.post(
            f'{TEST_SERVER_URL}/joinCommunityServer',
            params={'server_id': server_id}
        )
        assert response.status_code == 400

    def test_featured_servers_admin_only(self):
        """Test that only admins can feature servers"""
        # TODO: Test with non-admin user first (should fail)
        # TODO: Test with admin user (should succeed)
        pass

    def test_member_count_updated_on_join(self):
        """Test that member_count is updated when users join"""
        # Create a community server
        response = self.session.post(f'{TEST_SERVER_URL}/createServer')
        server_id = int(response.text.strip('"'))

        self.session.post(
            f'{TEST_SERVER_URL}/editServer',
            params={'property': 'is_community', 'id': server_id, 'value': 'true'}
        )

        # Get initial member count
        response = self.session.get(f'{TEST_SERVER_URL}/getDiscoverableServers')
        data = json.loads(response.text)
        all_servers = data['featured'] + data['regular']
        server = next((s for s in all_servers if s['id'] == server_id), None)
        initial_count = server['member_count'] if server else 0

        # Have another user join
        session2 = requests.Session()
        # TODO: Authenticate as different user
        session2.post(
            f'{TEST_SERVER_URL}/joinCommunityServer',
            params={'server_id': server_id}
        )

        # Check member count increased
        response = self.session.get(f'{TEST_SERVER_URL}/getDiscoverableServers')
        data = json.loads(response.text)
        all_servers = data['featured'] + data['regular']
        server = next((s for s in all_servers if s['id'] == server_id), None)
        new_count = server['member_count'] if server else 0

        assert new_count == initial_count + 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
