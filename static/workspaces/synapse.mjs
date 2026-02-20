
const synapseView = {
    address_debug: "http://localhost:810",
    address: "https://synapse.carbonlab.dev",
    name: "mycelium",
}

function importComponent(){
    const debug = global.state.location.host.startsWith("localhost")
    let url
    if (debug){
        url = synapseView.address_debug+"/static/components/"+synapseView.name+".mjs"
    }else{
        url = synapseView.address+"/static/components/"+synapseView.name+".mjs"
    }

    //importing the component
    import(url).then((module) => {
        console.log("Component imported successfully:", module);
        if (module.init) {
            module.init();
        } else {
            console.warn("The imported module does not have an 'initializeComponent' function.");
        }
    }).catch((error) => {
        console.error("Error importing component:", error);
    });

}

importComponent()