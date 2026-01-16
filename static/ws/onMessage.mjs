import global from "../framework/global.mjs";
import {xhr} from "../framework/templating.mjs";
import {displayNotif, postWS} from "../main.mjs";
import {setElement, pushElement, deleteElement, addElement} from "../framework/vesta.mjs";
import {handleMessageGroup} from "../crud.mjs";

export async function onMessage(event) {
    console.log("Received message from Python server:", event.data);
    const message = JSON.parse(event.data)
    switch (message.type){
        case "register_request":
            //TODO handle multiserver xhr with the received servID

            const effect = function (){
                global.state.clientID = JSON.parse(this.responseText)
                postWS()
            }

            xhr("authWS?connectionId=".concat(message.connectionId),effect)
            break
        case "notif":
            switch (message.content.type){
                case "message":
                    const currentDate = new Date()
                    const timestamp = currentDate.getTime()
                    message.content.content["timestamp"] = timestamp
                    if(message.content.content.place === global.state.activeConv){
                        handleMessageGroup(message.content.content)

                        addElement('global.convs['.concat(message.content.content.place,'].messages'), message.content.content)
                    }else{
                        displayNotif(message.content)
                    }
                    break;
                case "friend_request":
                    loadUsers([message.content.content["kopinprincipal"]])
                    pushElement('global.user.invitations', message.content.content)
                    displayNotif(message.content)
                    break;
                case "accepted_request":
                    loadUsers([message.content.content["kopinsecondaire"]])
                    pushElement('global.user.friends', message.content.content)
                    for(let i in global.user.invitations){
                        const request = global.user.invitations[i]
                        if (request.id === message.content.content.id){
                            deleteElement("global.user.invitations", i)
                            break
                        }
                    }
                    break;
                case "added_conv":
                    addElement('global.convs', message.content.content)
                    break;
                case "update_status":
                    if (message.content.content.id === global.user.id){
                        setElement('global.user.status', message.content.content.status)
                    }
                    setElement('global.users['.concat(message.content.content.id,"].status"), message.content.content.status)
                    break;
                case "typing":
                    if(global.state.activeConv === message.content.conv){
                        const box = document.getElementById("typing-name")
                        box.parentElement.style.display="flex";
                        // todo handle multiple names
                        box.innerHTML = global.users[message.content.uid].display
                        setTimeout(() => box.parentElement.style.display="none", 5000)
                    }
                    break
                case "edit_conv":
                    if (message.content.item === "name"){
                        setElement('global.convs['+message.content.id+'].name', message.content.content)
                    }
                    break;

                case "message_edited":
                    const editData = message.content.content;
                    const messageId = editData.id.id; // Backend sends message object with id property
                    const newContent = editData.content;
                    const conversationId = editData.id.place;

                    const conv = global.convs[conversationId];
                    if (conv && conv.messages && conv.messages[messageId]) {
                        setElement(`global.convs[${conversationId}].messages[${messageId}].body`, newContent);
                        setElement(`global.convs[${conversationId}].messages[${messageId}].edited`, true);
                    }
                    break;

                case "call_started":
                    const callData = message.content.content;

                    // Update conversation with ongoing call info
                    if (callData.conversation_id) {
                        setElement(`global.convs[${callData.conversation_id}].ongoingCall`, callData);
                    }

                    // Show notification if we're not the initiator
                    if (callData.participants[0] !== global.user.id) {
                        showIncomingCallNotification(callData);
                    }
                    break;

                case "call_participant_joined":
                    const callManager = global.state.callManager;
                    const joinData = message.content.content;

                    // Update conversation call state
                    if (joinData.call && joinData.call.conversation_id) {
                        setElement(`global.convs[${joinData.call.conversation_id}].ongoingCall`, joinData.call);
                    }

                    // Handle participant join for active call
                    if (callManager && callManager.currentCall) {
                        await callManager.handleParticipantJoined(
                            joinData.call,
                            joinData.user_id
                        );
                    }
                    break;

                case "call_participant_left":
                    const cm = global.state.callManager;
                    const leftData = message.content.content;

                    // Update conversation call state
                    if (leftData.call && leftData.call.conversation_id) {
                        setElement(`global.convs[${leftData.call.conversation_id}].ongoingCall`, leftData.call);
                    }

                    // Handle participant leave for active call
                    if (cm && cm.currentCall) {
                        cm.handleParticipantLeft(
                            leftData.call,
                            leftData.user_id
                        );
                    }
                    break;

                case "call_ended":
                    const callMgr = global.state.callManager;
                    const endData = message.content.content;

                    // Clear ongoing call from conversation
                    if (endData.conversation_id) {
                        setElement(`global.convs[${endData.conversation_id}].ongoingCall`, null);
                    }

                    // Clean up if we're in this call
                    if (callMgr) {
                        callMgr.cleanup();
                    }
                    break;

                case "call_mode_switch":
                    const modeCallManager = global.state.callManager;
                    if (modeCallManager && modeCallManager.currentCall &&
                        modeCallManager.currentCall.id === message.content.content.call_id) {
                        modeCallManager.handleModeSwitch(message.content.content.new_mode);
                    }
                    break;

                case "callOffer":
                    const offerMgr = global.state.callManager;
                    if (offerMgr && offerMgr.currentCall) {
                        offerMgr.handleOffer(
                            message.content.content.from_user,
                            message.content.content.signal
                        );
                    }
                    break;

                case "callAnswer":
                    const answerMgr = global.state.callManager;
                    if (answerMgr && answerMgr.currentCall) {
                        answerMgr.handleAnswer(
                            message.content.content.from_user,
                            message.content.content.signal
                        );
                    }
                    break;

                case "callIce":
                    const iceMgr = global.state.callManager;
                    if (iceMgr && iceMgr.currentCall) {
                        iceMgr.handleIceCandidate(
                            message.content.content.from_user,
                            message.content.content.signal
                        );
                    }
                    break;

                default:
                    break;
            }
            break;
        default:
            break;
    }

}