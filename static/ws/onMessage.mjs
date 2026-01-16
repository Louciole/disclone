import global from "../framework/global.mjs";
import {xhr} from "../framework/templating.mjs";
import {displayNotif, postWS} from "../main.mjs";
import {setElement, pushElement, deleteElement, addElement} from "../framework/vesta.mjs";
import {handleMessageGroup} from "../crud.mjs";

export function onMessage(event) {
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
                        pushElement('global.convs['.concat(message.content.content.place,'].messages'),message.content.content)
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

                case "call_started":
                    const callData = message.content.content;

                    if (callData.participants[0] !== global.user.id) {
                        if (callData.conversation_id === global.state.activeConv) {
                            showIncomingCallNotification(callData);
                        }
                    }
                    break;

                case "call_participant_joined":
                    const callManager = global.state.callManager;
                    if (callManager && callManager.currentCall) {
                        callManager.currentCall = message.content.content.call;

                        if (message.content.content.mode_changed) {
                            callManager.mode = message.content.content.call.mode;
                        }

                        callManager.updateCallUI();
                    }
                    break;

                case "call_participant_left":
                    const cm = global.state.callManager;
                    if (cm && cm.currentCall) {
                        cm.currentCall = message.content.content.call;
                        cm.handlePeerDisconnection(message.content.content.user_id);
                        cm.updateCallUI();
                    }
                    break;

                case "call_ended":
                    const callMgr = global.state.callManager;
                    if (callMgr) {
                        callMgr.cleanup();
                    }
                    break;

                case "call_mode_switch":
                    const mgr = global.state.callManager;
                    if (mgr && mgr.currentCall &&
                        mgr.currentCall.id === message.content.content.call_id) {
                        mgr.handleModeSwitch(message.content.content.new_mode);
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