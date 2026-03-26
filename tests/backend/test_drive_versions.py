import json

from tests.backend.backend import TEST_SERVER_URL, with_test_user


def _create_drive_channel(session, server_id):
    response = session.post(
        f'{TEST_SERVER_URL}/edit_server_channel',
        params={
            'server_id': server_id,
            'action': 'create',
            'channel_type': 'drive'
        }
    )
    assert response.status_code == 200, f"Failed to create drive channel: {response.text}"
    payload = response.json()
    return payload["channel"]["id"]


@with_test_user("drive_versions")
def test_drive_file_version_history(session):
    create_server = session.post(f'{TEST_SERVER_URL}/create_server')
    assert create_server.status_code == 200, f"Failed to create server: {create_server.text}"
    server_id = create_server.json()['id']

    drive_id = _create_drive_channel(session, server_id)

    upload_response = session.post(
        f'{TEST_SERVER_URL}/upload_drive_file',
        params={
            'drive_id': drive_id,
            'filename': 'notes.txt',
            'file': 'Zmlyc3Q='
        }
    )
    assert upload_response.status_code == 200, f"Upload failed: {upload_response.text}"
    file_id = upload_response.json()["file_id"]

    replace_response = session.post(
        f'{TEST_SERVER_URL}/replace_drive_file',
        params={
            'file_id': file_id,
            'filename': 'notes.txt',
            'file': 'c2Vjb25k'
        }
    )
    assert replace_response.status_code == 200, f"Replace failed: {replace_response.text}"
    assert replace_response.json()["version_count"] == 2

    versions_response = session.get(
        f'{TEST_SERVER_URL}/get_drive_file_versions',
        params={'file_id': file_id}
    )
    assert versions_response.status_code == 200, f"Get versions failed: {versions_response.text}"
    versions = json.loads(versions_response.text)
    assert len(versions) == 1, f"Expected one archived version, got {len(versions)}"
    assert versions[0]["version_number"] == 1
    assert versions[0]["filename"] == "notes.txt"

    restore_response = session.post(
        f'{TEST_SERVER_URL}/restore_drive_file_version',
        params={'file_id': file_id, 'version_number': 1}
    )
    assert restore_response.status_code == 200, f"Restore failed: {restore_response.text}"
    assert restore_response.json()["version_count"] == 3

    download_response = session.get(
        f'{TEST_SERVER_URL}/download_drive_file',
        params={'file_id': file_id}
    )
    assert download_response.status_code == 200, f"Download failed: {download_response.text}"
    assert download_response.content == b'first'

    return ("Drive file versions can be listed and restored", True)
