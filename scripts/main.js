var canvas = new fabric.Canvas('canvas', {
    hoverCursor: 'pointer',
    selection: false,
    preserveObjectStacking: true
});

var line, isDrawing;
var arr = new Array();
var temp = 0;
var unitCount = 0;
var hoverText;
var round = 0;

var from;
var to;

var scale = 5; // Pixel edge per soldier

// Each unit is a group
// [rect, image]
var units = new Array();
// Unordered
var collisions = new Array();
// {origin, target}
var connections = new Array();
// Unit types
var unitTypes = {};

fabric.Object.prototype.toObject = (function (toObject) {
    return function (properties) {
        return fabric.util.object.extend(toObject.call(this, properties), {
            textID: this.textID
        });
    };
})(fabric.Object.prototype.toObject);

canvas.on({
    'object:moving': onObjMove,
    'object:scaling': onObjMove,
    'object:scaling': onObjScale,
    'object:rotating': onObjMove,
    'mouse:over': onOver,
    'mouse:out': onOut,
    'mouse:dblclick': onDblClick,
    'mouse:down': onDown,
    'mouse:move': onMove,
    'selection:created': onSelection,
    'selection:updated': onSelection,
    'selection:cleared': onDeselect,
})

//=====================================================================
// CLASSES
//=====================================================================

var Stat = {
    STR: 1,
    DEX: 2,
    CON: 3,
    WIS: 4,
    ITL: 5,
    CHA: 6
}

class UnitType {
    constructor(name, cr, ac, hp, dmg, attks, str, dex, con, wis, itl, cha, prf, main) {
        this.name = name;
        this.cr = cr;
        this.hp = hp;
        this.ac = ac;
        this.attks = attks; //Number of attacks
        this.dmg = dmg; //Average damage per attack
        this.main = main; // Main attack stat
        this.str = str;
        this.dex = dex;
        this.con = con;
        this.wis = wis;
        this.itl = itl;
        this.cha = cha;
        this.prf = prf; //Proficiency
        this.morale = wis+2;
        this.custRoll = 0;
    }
}

class Unit {
    constructor(name, type, num, engaged, morale) {
        this.name = name;
        this.type = type;
        this.hpDmg = 0;
        this.tempHpDmg = 0;
        this.tempHpApldDmg = 0;
        this.tempApldDmgNum = 0;
        this.num = num;
        this.origNum = num;
        this.combatLosses = 0;
        this.directLosses = 0;
        this.morale = morale;
        this.engaged = engaged;
        this.fitness = "Fit";
        this.integrity = "Fresh";
        this.adv = "Normal";
        this.vuln = false;
    }

    setCustRoll(roll) {
        this.custRoll = roll ? roll : 0;
    }

    // Advantage
    setAdv(adv, vuln) {
        this.adv = adv;
        this.vuln = vuln;
    }

    // Staged Damage
    addTempDamage(damage) {
        this.tempHpDmg = this.tempHpDmg + damage;
    }

    addTempDirectDamage(damage) {
        this.tempHpApldDmg = this.tempHpApldDmg + damage;
    }

    // Staged Losses
    addCombatLosses(losses) {
        this.combatLosses = Math.min(losses, this.num - this.getStagedLosses());
    }

    addDirectLosses(losses) {
        this.directLosses = Math.min(losses, this.num - this.getStagedLosses());
    }

    getStagedLosses() {
        return this.combatLosses + this.directLosses;
    }

    setTempApldDmgNum(num) {
        if (num > this.tempApldDmgNum) this.tempApldDmgNum = num;
    }

    // Apply staged losses/damage
    applyResults() {
        // Adjust HP for losses
        console.debug("Reduced Damage to Loss: " + (-1 * this.getStagedLosses() * this.type.hp));
        this.addTempDirectDamage(-1 * this.directLosses * this.type.hp);
        this.addTempDamage(-1 * this.combatLosses * this.type.hp);
        // Apply damage to HP pool
        this.hpDmg = this.hpDmg + this.tempHpDmg + this.tempHpApldDmg;
        // Reset staged damage
        this.tempHpDmg = 0;
        this.tempHpApldDmg = 0;
        this.tempApldDmgNum = 0;
        console.debug("Casualties: " + this.num + ", " + this.losses);
        this.num = this.num - this.getStagedLosses();
        this.combatLosses = 0;
        this.directLosses = 0;
    }

    resetStagedResults() {
        this.tempHpDmg = 0;
        this.losses = 0;
    }

    setNum(num) {
        this.num = num;
    }

    addNum(num) {
        this.num = this.num + num;
    }

    setEngaged(engaged) {
        this.engaged = engaged;
    }

    getMainAttBonus() {
        var mod = this.type.prf;
        switch (this.type.main) {
          case Stat.STR:
            mod = mod + this.type.str;
            break;
          case Stat.DEX:
            mod = mod + this.type.dex;
            break;
          case Stat.CON:
            mod = mod + this.type.con;
            break;
          case Stat.WIS:
            mod = mod + this.type.wis;
            break;
          case Stat.ITL:
            mod = mod + this.type.itl;
            break;
          case Stat.CHA:
            mod = mod + this.type.cha;
        }
        return mod;
    }
}

//=====================================================================
// QUERIES/HELPERS
//=====================================================================

// If only one param, return all combats that unit is involved in
// If two params, return single combat both units are involved in
// Unorderd pair
function getCollisions(x, y) {
    if (y === undefined) {
        var ret = [];
        for (var i = 0; i < collisions.length; i++) {
            if (collisions[i][0] == x || collisions[i][1] == x) {
                ret.push(i);
            }
        }
    } else {
        var ret = -1
        for (var i = 0; i < collisions.length; i++) {
            if ((collisions[i][0] == y && collisions[i][1] == x) || 
                (collisions[i][0] == x && collisions[i][1] == y)) {
                ret = i;
            }
        }
    }
    return ret;
}

// Syntax: (Originator of connection, Inbound Connection)
// Ordered pair
function getConnections(x, y) {
    if (y === undefined) {
        // Finding whatever child is connected to
        for (var i = 0; i < connections.length; i++) {
            if (connections[i][0] == x) {
                return connections[i];
            }
        }
    } else if (x === null) {
        // Finding all inbound connections
        var ret = [];
        for (var i = 0; i < connections.length; i++) {
            if (connections[i][1] == y) {
                ret.push(i);
            }
        }
        return ret;
    }
    return [];
}

function getAttackingEngagements(unit) {
    var combats = [];
    var melee = getCollisions(unit.id);
    var ranged = getConnections(unit.id);
    for (let x of melee)
        combats.push(collisions[x]);
    for (let y of ranged) {
        combats.push(connections[y]);
    }
    return combats;
}

function getDefendingEngagements(unit) {
    var combats = [];
    var melee = getCollisions(unit.id);
    var ranged = getConnections(null, unit.id);
    for (let x of melee)
        combats.push(collisions[x]);
    for (let y of ranged)
        combats.push(connections[y]);
    return combats;
}

// This method is just fucking shortcuts but that's fine I guess
function removeFromBoard(unit) {
    canvas.remove(unit.lossText);
    unit.lossText = null;
    unit.set({
        left: "0px",
        top: "0px"
    });
    removeConnections(unit);
    canvas.remove(unit);
    units[unit.stats.id] = null;
    canvas.renderAll();
}

function updateLines(unit) {
    if (unit.line != null) {
        var childLine = unit.line;
        childLine.set({ x1: coord.x, y1: coord.y });
    }
    for (let incomingLine of unit.incomingLines) {
        incomingLine.set({ x2: coord.x, y2: coord.y });
    }
}

function removeConnections(unit) {
    if (unit.line != null) {
        canvas.remove(unit.line);
        unit.line = null;
    }
    connections.splice(getConnections(unit.id));
    for (let incomingLine of unit.incomingLines) {
        connections.splice(getConnections(incomingLine.parent.id), 1);
        canvas.remove(incomingLines);
    }
}

//=====================================================================
// EVENTS
//=====================================================================

function onObjMove(o) {
    o.target.setCoords();
    var coord = o.target.getCenterPoint();
    // Update loss text
    if (o.target.lossText != null) {
        o.target.lossText.set({
            left: coord.x-10,
            top: coord.y-10,
        })
        o.target.lossText.bringToFront();
    }
    // Update lines
    updateLines(o.target);
    // Detect Collisions
    for (let obj of units) {
        if (obj != null) {
            var collision = getCollisions(obj.id, o.target.id);
            if (o.target.intersectsWithObject(obj) && o.target.faction != obj.faction) {
                if (collision == -1) {
                    collisions.push([obj.id, o.target.id]);
                    o.target.item(0).set({'strokeWidth': 5, 'stroke': 'yellow'});
                    obj.item(0).set({'strokeWidth': 5, 'stroke': 'yellow'});
                    rollCombat();
                }
            } else {
                if (collision != -1) {
                    collisions.splice(collision, 1);
                    rollCombat();
                }
                if (getCollisions(obj.id).length == 0 && getConnections(null, obj.id).length == 0) {
                    obj.item(0).set({'strokeWidth': 2, 'stroke': 'black'});
                }
            }
        }
    }
    if (getCollisions(o.target.id).length == 0 && getConnections(null, o.target.id).length == 0) {
        o.target.item(0).set({'strokeWidth': 2, 'stroke': 'black'});
    }
}

function onDblClick(o) {
    if (o.target != undefined && !isDrawing && o.target.get('type') == 'group') {
        isDrawing = true;
        var pointer = canvas.getPointer(o.e);
        var from = o.target.getCenterPoint();

        var points = [from.x, from.y, pointer.x, pointer.y];
        if (o.target.get('line') != null) {
            oldTarget = o.target.get('line').get('target');
            if(oldTarget != null) {
                connections.splice(getConnections(o.target.id), 1);
                rollCombat();
                if (getCollisions(oldTarget.id).length == 0 && getConnections(null, oldTarget.id).length == 0) {
                    oldTarget.item(0).set({'strokeWidth': 2, 'stroke': 'black'});
                }
            }
            canvas.remove(o.target.get('line'));
            o.target.set('line', null);
        }

        line = makeLine(points, o.target);
        o.target.set('line', line);
        canvas.add(line);
        line.sendToBack();
    }
}

function onMove(o) {
    canvas.renderAll();
    if (isDrawing) {
        var pointer = canvas.getPointer(o.e);
        line.set({ x2: pointer.x, y2: pointer.y });
    }
}
        
function onDown(o) {
    if (isDrawing) {
        if (o.target != undefined && o.target.faction != line.stroke) {
            var coord = o.target.getCenterPoint();
            line.set({ x2: coord.x, y2: coord.y, target: o.target });
            o.target.get('incomingLines').push(line);
            o.target.item(0).set({'strokeWidth': 5, 'stroke': 'yellow'});
            connections.push([line.parent.id, o.target.id]);
            rollCombat();
            isDrawing = false;
        } else {
            line.get('parent').set('line', null);
            canvas.remove(line);
            isDrawing = false;
        }
    }
}

function onOver(o) {
    if (o.target != null) {
        o.target.setCoords();
        var pointer = canvas.getPointer(o.e);
        if ((hoverText == null || hoverText == undefined) && o.target.stats != undefined) {
            var textInfo = o.target.stats.type.name + "\n";
            if(o.target.stats.adv != "Normal") textInfo = o.target.stats.adv + "\n";
            if(o.target.stats.vuln) textInfo = textInfo + "Vulnerable\n";
            textInfo = textInfo +
                o.target.stats.num + "/" + o.target.stats.origNum + " Troops\n" +
                Math.min(o.target.stats.num, o.target.stats.engaged) + " Engaged\n" + 
                o.target.stats.tempHpDmg + " Expected Dmg\n" +
                o.target.stats.tempHpApldDmg + " Exp. Direct Dmg\n" +
                o.target.stats.fitness + "\n" +
                o.target.stats.integrity;
            hoverText = new fabric.Text(textInfo, {
                //shadow: 'rgba(256,256,256,1) 0 0 40px',
                evented: false,
                fontFamily: 'Impact',
                stroke: 'white',
                borderColor: o.target.faction,
                fill: 'black',
                backgroundColor: 'rgba(256,256,256,0.9)',
                fontSize: 16,
                left: pointer.x+10,
                top: pointer.y,
            });
            canvas.add(hoverText);
            hoverText.bringToFront();
        }
    }
}

function onOut(o) {
    canvas.remove(hoverText);
    hoverText = null;
}

function onSelection(o) {
    updateStatBlock(o.target);
    fetchCustRoll(o.target);
    o.target.bringToFront();
    document.getElementById('perUnit').style.visibility="visible";
    document.getElementById('adv').value = o.target.stats.adv;
    document.getElementById('vuln').checked = o.target.stats.vuln;
    document.getElementById('directDamageNum').value = 1;
    if (hoverText != null && hoverText != undefined)
        hoverText.bringToFront();
    if (o.target.lossText != null && o.target.lossText != undefined)   
        o.target.lossText.bringToFront();
}

function onDeselect(o) {
    document.getElementById('perUnit').style.visibility="hidden";
    document.getElementById('stat_block').innerHTML = "";
}

function onObjScale(o) {
    o.target.setCoords();
}

//=====================================================================
// FORM
//=====================================================================

function fetchCustRoll(unit) {
    document.getElementById('custRoll').value = unit.stats.custRoll;
}

function setCustRoll() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    var custRoll = parseInt(document.getElementById('custRoll').value, 10);
    selected.stats.setCustRoll(custRoll);
    rollCombat();
}

function setEngaged() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    selected.stats.setEngaged(parseInt(document.getElementById('engNum').value, 10));
    scaleUnit(selected);
    selected.setCoords();
    canvas.renderAll();
    rollCombat();
}

function addNum() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    selected.stats.setNum(parseInt(selected.stats.num, 10) + parseInt(document.getElementById('numDelta').value), 10);
    scaleUnit(selected);
    rollCombat();
}

function setAdv() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    selected.stats.setAdv(document.getElementById('adv').value,
                          document.getElementById('vuln').checked);
    /*
    if (selected.stats.vuln) {
        selected.item(0).set('opacity', 0.25);
    } else {
        selected.item(0).set('opacity', 0.5);
    }
    switch (selected.stats.adv) {
        case "Advantage":
            selected.item(1).set('opacity', 1);
        case "Normal":
            selected.item(1).set('opacity', 0.75);
        case "Disadvantage":
            selected.item(1).set('opacity', 0);
        default:
            break;
    }
    */
    rollCombat();
}

{
    var remoteUnitTypes = '';
    var xmlhttp = new XMLHttpRequest();
    xmlhttp.onreadystatechange = function(){
      if(xmlhttp.status == 200 && xmlhttp.readyState == 4){
        remoteUnitTypes = xmlhttp.responseText;
      }
    };
    //xmlhttp.open("GET", "https://dgmihai.github.io/pitched-battle/resources/units.csv", true);
    xmlhttp.open("GET", "https://raw.githubusercontent.com/dgmihai/pitched-battle/master/resources/units.csv", true);
    xmlhttp.send();

    console.log("Heh?" + remoteUnitTypes);

    if(!remoteUnitTypes) {
        var localUnitTypes = localStorage.getItem('unitTypes');
        if(localUnitTypes != "null") {
            console.log("Found saved unit types!");
            populateUnitTypes(localUnitTypes);
        }
    }
}

function populateUnitTypes(input) {
    var select = document.getElementById("types");
    select.options.length = 0;
    // By lines
    var lines = input.split('\r');
    var count = 0;
    var group = null;
    for(var line = 0; line < lines.length; line++) {
        console.debug("Line: " + lines[line]);
        var cols = lines[line].split(',');
        console.debug(cols);
        if (cols[1] == "X") {
            // New class of unit
            if (group != null) select.appendChild(group);
            group = document.createElement('optgroup');
            group.setAttribute("label", cols[0]);
            console.log("Group: " + group + " , " + cols[0]);
            console.log("Creating group");
        } else {
            var newType = new UnitType( 
                cols[0], // Name
                parseInt(cols[1], 10), // Challenge Rating
                // 2 - Tier
                // 3 - Num
                parseInt(cols[4], 10), // Armor Class
                parseInt(cols[5], 10), // Health of Individual Number
                parseInt(cols[6], 10), // Primary Attack Average Damage
                // 7 - To Hit
                // 8 - Number of Dice
                // 9 - Damage Mod
                parseInt(cols[10], 10), // Primary Attack Count or Mod (???)
                // 11 - Roll Modifier
                parseInt(cols[12], 10), // Str
                parseInt(cols[13], 10), // Dex
                parseInt(cols[14], 10), // Con
                parseInt(cols[15], 10), // Wis
                0, // Int
                0, // Cha
                parseInt(cols[16], 10), // Proficiency Bonus
                toStat(cols[17]) // Main Attack Stat
            );
            unitTypes[cols[0]] = newType;
            group.appendChild(new Option(newType.name));
            count++;
        }
    }
}

document.getElementById('file').onchange = function() {
    var file = this.files[0];

    var reader = new FileReader();
    reader.onload = function(progressEvent) {
        localStorage.setItem('unitTypes', this.result);
        populateUnitTypes(this.result);
    };
    reader.readAsText(file);
};

function toStat(stat) {
    switch (stat) {
        case "STR":
            return Stat.STR;
        case "DEX":
            return Stat.DEX;
        case "CON":
            return Stat.CON;
        case "WIS":
            return Stat.WIS;
        case "INT":
            return Stat.ITL;
        case "CHA":
            return Stat.CHA;
    }
}

function fillEngaged() {
    //var size = parseInt(document.getElementById('unitSize').value, 10);
    //document.getElementById('unitEngaged').value = Math.floor(Math.sqrt(size*2));
}

function deleteUnit() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    removeFromBoard(selected);
}

//=====================================================================
// DRAWING & UNIT CREATION
//=====================================================================

// Define the URL where your background image is located
var imageUrl = "./img/Map.jpg";

fabric.Image.fromURL('img/Map.jpg', function(img){
    img.scaleToWidth(canvas.width);
    img.set('opacity', 0.9);
    canvas.setBackgroundImage(img);
    canvas.requestRenderAll();
});

function scaleUnit(unit) {
    var newX = unit.stats.engaged*scale;
    var newY = (unit.stats.num/unit.stats.engaged)*scale;
    unit.set({
        scaleX: newX/unit.width,
        scaleY: newY/unit.height,
    });
}

// function for drawing a line
function makeLine(coords, origin) {
    return new fabric.Line(coords, {
        strokeDashArray: [5, 5],
        stroke: origin.faction,
        opacity: 0.2,
        strokeWidth: 10,
        selectable: false,
        parent: origin,
        originx: coords[0],
        originy: coords[1],
        target: null
    });
}

function addUnit(faction) {
    var unitSize = parseInt(document.getElementById('unitSize').value, 10);
    var unitEngaged = parseInt(document.getElementById('unitEngaged').value, 10);

    var rect = new fabric.Rect({
        width: unitEngaged*scale, height: unitSize/unitEngaged*scale,
        strokeWidth: 2,
        stroke: 'black',
        fill: faction,
        angle: 0,
        originX: "center",
        originY: "center",
        centeredScaling: true,
        centeredRotation: true,
        opacity: 0.5,
        selectable: false,
        shadow: 'rgba(0,0,0,1) 0px 0px 20px'
    });

    var typeList = document.getElementById('types');
    var type = unitTypes[typeList.options[typeList.selectedIndex].value];
    var stats = new Unit(unitCount + " Unit", type, unitSize, unitEngaged);

    fabric.Image.fromURL('./img/heavyinf.png', function(img) {
        img.set({
            scaleX: (unitEngaged*scale)/img.width,
            scaleY: (unitSize/unitEngaged*scale)/img.height,
            originX: "center",
            originY: "center",
        });
        var unit = new fabric.Group([rect, img]);
        units.splice(unitCount, 0, unit);
        unit.set({
            'id': unitCount,
            'incomingLines': [],
            'faction': unit.item(0).fill,
            'stats': stats,
            top: 100, left: 100});
        canvas.add(unit);
        unit.on('mousemove', function(o) {
            if (hoverText != null || hoverText != undefined) {
                var pointer = canvas.getPointer(o.e);
                hoverText.set({
                    left: pointer.x+10,
                    top: pointer.y,
                    selectable: false
                });
                hoverText.bringToFront();
            }
        });
        unitCount++;
        scaleUnit(unit);
    });

    canvas.requestRenderAll();
}

function displayLossText(unit) {
    if(unit.lossText) {
        canvas.remove(unit.lossText);
        unit.lossText = null;
    }
    unit.setCoords();
    var coord = unit.getCenterPoint();
    var txt = unit.stats.num == unit.stats.getStagedLosses() ? "KO" : "-" + unit.stats.getStagedLosses();
    unit.lossText = new fabric.Text(txt, {
        shadow: 'rgba(0,0,0,1) 0 0 40px',
        selectable: false,
        fontFamily: 'Impact',
        stroke: 'white',
        strokeWidth: 2,
        fill: unit.faction,
        //backgroundColor: 'rgba(256,256,256,0.75)',
        fontSize: 20,
        left: coord.x-10,
        top: coord.y-10,
        evented: false
    });
    canvas.add(unit.lossText);
}

//=====================================================================
// STAT BLOCK
//=====================================================================

// Unit stat block on the left
function updateStatBlock(unit) {
    var text =
        "Name: " + unit.stats.type.name +
        "<br>CR: " + unit.stats.type.cr +
        "<br><br>AC: " + unit.stats.type.ac +
        "<br>HP: " + unit.stats.type.hp +
        "<br>To Hit: " + unit.stats.getMainAttBonus() +
        "<br>Avg Dmg: " + unit.stats.type.dmg +
        "<br><br>Sus. Dmg: " + unit.stats.hpDmg +
        "<br>Number: " + unit.stats.num + "/" + unit.stats.origNum +
        "<br><br>STR: " + unit.stats.type.str +
        "<br>DEX: " + unit.stats.type.dex +
        "<br>CON: " + unit.stats.type.con +
        "<br>WIS: " + unit.stats.type.wis +
        "<br>INT: " + unit.stats.type.itl +
        "<br>CHA: " + unit.stats.type.cha;
    document.getElementById('stat_block').innerHTML = text;
}

//=====================================================================
// CALCULATE COMBAT
//=====================================================================

function rollCombat() {
    for (let unit of units) {
        if (unit != null) {
            unit.stats.resetStagedResults();
            canvas.remove(unit.lossText);
            unit.lossText = null;
            if(document.getElementById('roll').checked == true) {
                var combats = getDefendingEngagements(unit);
                if (combats.length > 0) {
                    for (let combat of combats) {
                        var attacker = combat[0] != unit.id ? units[combat[0]] : units[combat[1]];
                        stageAttacks(attacker, unit, getAttackingEngagements(attacker).length, attacker.stats.adv);
                    }
                }
            }
            if(unit.stats.tempHpDmg > 0 || unit.stats.tempHpApldDmg > 0) {
                stageLosses(unit);
                console.debug(unit.stats.getStagedLosses());
            }
        }
    }
}

function stageDirectDamage() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    var num = Math.max(parseInt(document.getElementById('directDamageNum').value, 10), selected.stats.tempApldDmgNum);
    var amount = parseInt(document.getElementById('directDamageAmt').value, 10) * num;
    selected.stats.setTempApldDmgNum(num);
    selected.stats.addTempDirectDamage(amount);
    console.debug("Applied damage: " + selected.stats.tempHpApldDmg);
    stageLosses(selected, true);
}

function stageAttacks(attacker, defender, split, advantage) {
    var roll = attacker.stats.custRoll;
    console.log("Existing roll: " + roll);
    if(attacker.stats.custRoll == 0 || attacker.stats.custRoll == undefined) {
        var bonus = attacker.stats.getMainAttBonus();
        var roll = Math.floor(Math.random() * 19) + 1 + bonus;
        console.debug("Roll: " + roll);
        console.debug(advantage);
        if (advantage != "Normal") {
            //console.debug("Rolling with dis/advantage");
            secondRoll = Math.floor(Math.random() * 19) + 1 + bonus;
            console.debug("Second Roll: " + secondRoll);
            switch (advantage) {
                case "Advantage":
                    roll = Math.max(roll, secondRoll);
                case "Disadvantage":
                    roll = Math.min(roll, secondRoll);
            }
        }
    }
    console.debug("Final Roll: " + roll);
    console.debug("AC: " + defender.stats.type.ac);
    var factor = Math.floor((roll - defender.stats.type.ac) / 5);
    var dmg = (attacker.stats.type.dmg * Math.min(attacker.stats.num, attacker.stats.engaged))/split;
    // Calculate potential damage
    console.debug("Pot Dmg: " + dmg);
    defender.stats.addTempDamage(factor >= 0 ? dmg : factor >= -1 ? dmg/2 : factor >= -2 ? dmg/4 : 0);
}

function stageLosses(unit, direct=false) {
    var num = Infinity;
    if(direct) num = unit.stats.tempApldDmgNum;
    // Calculate losses
    var losses = Math.floor(Math.random() * Math.min(Math.floor((unit.stats.tempHpDmg+unit.stats.hpDmg+unit.stats.tempHpApldDmg)/unit.stats.type.hp)), num);
    if(unit.stats.vuln)
        console.debug("Vulnerable!")
        losses = Math.max(Math.floor(Math.random() * Math.min(Math.floor((unit.stats.tempHpDmg+unit.stats.hpDmg+unit.stats.tempHpApldDmg)/unit.stats.type.hp)), num));
    var percentDamage = (unit.stats.tempHpDmg+unit.stats.hpDmg)/(unit.stats.type.hp*unit.stats.num);
    unit.stats.fitness = "Fit";
    if (percentDamage > 0.1) {
        // Bloodied
        unit.stats.fitness = "Bloodied";
        if (percentDamage > 0.3) {
            // Ravaged
            unit.stats.fitness = "Maimed";
            losses = Math.max(losses, Math.floor(Math.random() * Math.floor(unit.stats.tempHpDmg/unit.stats.type.hp)));
            if (percentDamage > 0.5) {
                // Crippled
                unit.stats.fitness = "Crippled";
                losses = losses * 2;
                if (percentDamage > 1.5) {
                    // Wipeout
                    unit.stats.fitness = "Destroyed";
                    losses = unit.stats.num;
                }
            }
        }
    }
    console.debug("Losses: " + losses);
    if (direct) {
        unit.stats.addDirectLosses(losses);
    } else {
        unit.stats.addCombatLosses(losses);
    }
    displayLossText(unit);
}

//=====================================================================
// APPLY COMBAT
//=====================================================================

function applyCombat() {
    for (let unit of units) {
        if (unit != null) applyUnitCombat(unit);
    }
    if(canvas.getActiveObject())
        updateStatBlock(canvas.getActiveObject());
    canvas.renderAll();
    rollCombat();
    if(document.getElementById('roll').checked == true) {
        round++;
        var text = document.getElementById('apply').firstChild;
        text.data = "Fight: Round " + (round+1);
    }
}

function applyUnitCombat(unit) {
    unit.stats.applyResults();
    var integrityRatio = unit.stats.num/unit.stats.origNum;
    var integrity =
        integrityRatio > 0.9 ? 'Fresh' :
        integrityRatio > 0.7 ? 'Taken Losses' :
        integrityRatio > 0.5 ? 'Heavy Losses' :
        integrityRatio > 0.3 ? 'Critical Losses' :
        'Decimated';
    unit.stats.integrity = integrity;
    var percentDamage = (unit.stats.tempHpDmg+unit.stats.hpDmg)/(unit.stats.type.hp*unit.stats.num);
    // SCALING
    if (unit.stats.num < unit.stats.engaged) unit.stats.setEngaged(unit.stats.num);
    scaleUnit(unit);
    unit.stats.setCustRoll(0);
    fetchCustRoll(unit);
    unit.setCoords();
    if (unit.stats.num == 0) {
        removeFromBoard(unit);
    }
}