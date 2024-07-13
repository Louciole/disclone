import {setElement} from "./framework/sakura.mjs";

function getQuizResult(answersCount){
    let metric1 = 0
    for(let i = 0; i<3; i++){
        if(answersCount[i] > answersCount[metric1]){
            metric1 = i
        }
    }
    const metric2 = answersCount[3]>answersCount[4]
    switch (metric1){
        case 0:
            if(metric2){
                return {name:"solo",description:"Le Solo est un personnage énigmatique qui évolue dans les marges. Son alignement moral se traduit par un code d'honneur personnel qu'il suit scrupuleusement. Il n'est pas redevable aux corporations ou à la loi officielle, mais à ses propres principes.\n" +
                        "\n" +
                        "Malgré son indépendance farouche, le Solo n'est pas un anarchiste. Il valorise la loyauté envers ceux qu'il considère comme ses égaux et respecte les contrats qu'il signe, même s'ils l'entraînent dans des situations périlleuses.\n" +
                        "\n" +
                        "Imaginez un samouraï urbain endurci, capable de se sortir de situations explosives grâce à ses talents de combat et son sens tactique hors pair. Le Solo est un mercenaire professionnel, qui vend ses services au plus offrant, mais toujours en respectant son propre code moral. Il voit la ville comme une jungle où les plus forts et les plus astucieux survivent."}
            }else{
                return {name:"nomade",description:"Le Nomade est un esprit indépendant et farouche qui sillonne les vastes étendues du désert. Son alignement chaotique le pousse à rejeter les structures et les contrôles imposés par les corporations et les cités. Pour lui, la liberté prime sur tout.\n" +
                        "\n" +
                        "Cependant, ce lien d'indépendance ne se traduit pas par un isolement total. Les Nomades forment des clans unis et solidaires, où la famille et la communauté passent avant tout. Ils partagent leurs ressources, protègent les leurs et affrontent ensemble les dangers des Badlands.\n" +
                        "\n" +
                        "Imaginez un explorateur intrépide, capable de survivre dans les conditions les plus hostiles. Le Nomad est un aventurier pragmatique, qui s'appuie sur son ingéniosité et son sens de la débrouillardise pour prospérer en marge de la société. Il voit la ville comme un piège doré, et les corporations comme des parasites qui polluent l'environnement.\n" +
                        "\n" +
                        "Son chaos n'est pas synonyme d'anarchie. C'est une liberté responsable envers son clan et l'environnement. Il se bat pour préserver son mode de vie et ses traditions face aux intrusions constantes du monde \"civilisé\". Le Nomad est un gardien farouche de sa propre destinée, qui trace sa route en fonction de ses besoins et de ses valeurs."}
            }
        case 1:
            if(metric2){
                return {name:"netrunner",description:"Le Netrunner est un esprit libre qui navigue les vastes étendues du Net. Son alignement chaotique le pousse à défier les puissances et les systèmes d'exploitation qui contrôlent la circulation de l'information.\n" +
                        "\n" +
                        "Pourtant, ce n'est pas un solitaire. Le Netrunner est un ardent défenseur du collectivisme. Il croit en la libre circulation de l'information et en l'accès égal aux connaissances pour tous. Il considère le Net comme un espace public qui doit être libéré de l'emprise des corporations.\n" +
                        "\n" +
                        "Imaginez un Robin des Bois numérique, capable de pirater les forteresses virtuelles des plus puissants et de redistribuer leurs secrets au peuple. Le Netrunner est un hacktiviste de haut vol, un agitateur qui sème le trouble dans les circuits des plus corrompus, tout en aidant les communautés oubliées à s'organiser et à se défendre.\n" +
                        "\n" +
                        "Son chaos est un instrument au service de la collectivité, une arme pour briser les chaînes de l'information controlée. Sa liberté n'a de sens que si elle permet de construire un monde plus juste et plus ouvert pour tous."}
            }else{
                return {name:"fixeur",description:"Le Fixeur est le rouage discret qui fait tourner la machine chaotique de notre univers. Son alignement moral le pousse à maintenir un certain ordre social dans ce monde impitoyable. Il comprend que sans un minimum de structure et de confiance, la ville sombrerait complètement dans l'anarchie.\n" +
                        "\n" +
                        "Pourtant, son sens de l'ordre ne profite pas qu'aux corporations ou aux puissants. Le Fixer est un collectiviste pragmatique. Il sait que la survie et la prospérité de notre monde dépendent d'un minimum de coopération et de commerce équitable. Il agit comme un intermédiaire, reliant les différents groupes et factions pour faire avancer les affaires et maintenir un fragile équilibre.\n" +
                        "\n" +
                        "Imaginez un chef de réseau astucieux, qui connaît les rouages de la ville mieux que quiconque. Le Fixer est un diplomate de l'ombre, capable de réunir des ennemis jurés pour un projet commun et de faire respecter les codes de la pègre. Son sens de l'ordre n'est pas rigide, mais flexible, adaptable aux besoins changeants de la ville.\n" +
                        "\n" +
                        "Son respect de la loi est contextuel. Il sait que certaines règles doivent être contournées pour le bien commun, mais il veille à ce que ces entorses restent contrôlées et ne fassent pas basculer la ville dans le chaos total. Le Fixer est un architecte de l'ombre, qui construit un ordre fragile et éphémère dans un monde voué à l'instabilité."}
            }
        case 2:
            if(metric2){
                return {name:"psycho",description:"Le Cyberpsycho est un cas unique dans notre univers. Son esprit, brisé par les implants cybernétiques, est en proie à un conflit constant. D'un côté, il aspire désespérément à l'ordre et au contrôle qu'il a perdus. De l'autre, ses augmentations et les psychoses qui en découlent le poussent vers des actes de violence chaotique et imprévisible.\nImaginez une machine de guerre déréglée, obsédée par la discipline et la propreté, mais incapable de résister aux pulsions incontrôlables qui le submergent. Un moment, il peut arpenter les rues en chantonnant un hymne national, et l'instant d'après, il peut exploser dans une rage meurtrière.\nLe Cyberpsycho est un être tragique, prisonnier d'un corps devenu étranger et d'un esprit en lambeaux. Sa quête d'ordre ne sert qu'à contenir la tempête qui gronde en lui, et son chaos est une manifestation déformée de son désir de contrôle."}
            }else{
                return {name:"corpo",description:"Le Corpo incarne la stabilité dans le monde impitoyable. Son alignement moral se traduit par un respect des lois et des institutions qui assurent la sécurité et la prospérité. Pour lui, l'ordre rigoureux est la base d'une société en constante évolution.\n" +
                        "\n" +
                        "Le Corpo ne voit pas le chaos comme un ennemi absolu, mais comme un obstacle à surmonter. Il croit en la force des structures et de la planification pour faire avancer la ville. L'accès à l'information est contrôlé pour éviter les manipulations et les désordres, les conflits sont résolus par des canaux établis, et la sécurité est garantie par un système juridique clair.\n" +
                        "\n" +
                        "Son sens de l'ordre n'est pas synonyme de rigidité. Il s'agit plutôt d'un ordre efficace et transparent, qui garantit l'égalité des chances et la protection de tous. Les lois qu'il respecte permettent la coopération et le progrès technologique. Le Corpo est un bâtisseur visionnaire, qui érige un cadre structuré et solide pour favoriser l'essor de la ville et de ses habitants."}
            }
    }
}

function selectAnswer(event){
    const alreadySelected = event.currentTarget.parentElement.querySelector(".selected")
    if(alreadySelected){
        alreadySelected.classList.remove("selected")
    }
    event.currentTarget.classList.add("selected")
}
window.selectAnswer = selectAnswer

function finishQuizzz(){
    let answerCount=[0,0,0,0,0]
    const quizzz = document.getElementById('testFactionSteps')
    for(let step of quizzz.children){
        const answer = step.querySelector(".selected")
        answerCount[answer.dataset.id]++
    }
    setElement("global.user.faction",getQuizResult(answerCount))
    closeMenu('#test-faction',"testFactionSteps")
}
window.finishQuizzz = finishQuizzz
