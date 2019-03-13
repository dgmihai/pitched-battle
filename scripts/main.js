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

var scale = 10; // Pixel edge per soldier

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
    }

    getName() {
        return this.name;
    }
}

class Unit {
    constructor(name, type, num, width, morale) {
        this.name = name;
        this.type = type;
        this.hpDmg = 0;
        this.tempHpDmg = 0;
        this.tempHpApldDmg = 0;
        this.num = num;
        this.origNum = num;
        this.losses = 0;
        this.morale = morale;
        this.width = width;
        this.fitness = "Fit";
        this.integrity = "Fresh";
        this.adv = "Normal";
        this.vuln = false;
    }

    setAdv(adv, vuln) {
        this.adv = adv;
        this.vuln = vuln;
    }

    addTempDamage(damage) {
        this.tempHpDmg = this.tempHpDmg + damage;
    }

    addTempDirectDamage(damage) {
        this.tempHpApldDmg = this.tempHpApldDmg + damage;
    }

    addLosses(losses) {
        this.losses = Math.min(losses, this.num);
    }

    applyResults() {
        this.hpDmg = this.hpDmg + this.tempHpDmg + this.tempHpApldDmg;
        this.tempHpDmg = 0;
        this.tempHpApldDmg = 0;
        console.debug("Casualties: " + this.num + ", " + this.losses);
        this.num = this.num - this.losses; // Handle through MATH
        this.losses = 0;
    }

    resetStagedResults() {
        this.tempHpDmg = 0;
        this.losses = 0;
    }

    setNum(num) {
        this.num = num;
    }

    setWidth(width) {
        this.width = width;
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
// QUERIES
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
    if (o.target.line != null) {
        var childLine = o.target.line;
        childLine.set({ x1: coord.x, y1: coord.y });
    }
    for (let incomingLine of o.target.incomingLines) {
        incomingLine.set({ x2: coord.x, y2: coord.y });
    }
    // Detect Collisions
    for (let obj of units) {
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
                connections.splice(getConnections(o.target.line.parent.id), 1);
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
                o.target.stats.num + "/" + o.target.stats.origNum + " Troops\n " +
                Math.min(o.target.stats.num, o.target.stats.width) + " Engaged\n" + 
                o.target.stats.hpDmg + " Damage\n" +
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
    o.target.bringToFront();
    document.getElementById('perUnit').style.visibility="visible";
    document.getElementById('adv').value = o.target.stats.adv;
    document.getElementById('vuln').checked = o.target.stats.vuln;
    document.getElementById('directDamageNum').value = o.target.stats.num;
    if (hoverText != null && hoverText != undefined)
        hoverText.bringToFront();
    if (o.target.lossText != null && o.target.lossText != undefined)   
        o.target.lossText.bringToFront();
}

function onDeselect(o) {
    document.getElementById('perUnit').style.visibility="hidden";
}

function onObjScale(o) {
    /*
    o.target.stats.setNum(Math.floor(o.target.getScaledWidth()*o.target.getScaledHeight()));
    o.target.stats.setWidth(Math.ceil(o.target.getScaledWidth()));
    if (hoverText != null && hoverText != undefined) {
        var textInfo = o.target.stats.num + " Troops\n " + o.target.stats.width + " Combat Width";
        hoverText.set('text', textInfo);
    }
    */
    o.target.setCoords();
    //rollCombat();
}

//=====================================================================
// FORM
//=====================================================================

function setEngaged() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    selected.stats.setWidth(parseInt(document.getElementById('engNum').value, 10));
    selected.item(0).set({
        scaleX: (selected.stats.width*scale)/selected.width,
        scaleY: ((selected.stats.num/selected.stats.width)*scale)/selected.height,
    });
    selected.item(1).set({
        scaleX: (selected.stats.width*scale)/selected.item(1).width,
        scaleY: ((selected.stats.num/selected.stats.width)*scale)/selected.item(1).height,
    });
    selected.setCoords();
    canvas.renderAll();
    rollCombat();
}

function setAdv() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    console.log(document.getElementById('adv').value);
    selected.stats.setAdv(document.getElementById('adv').value,
                          document.getElementById('vuln').checked);
}

document.getElementById('file').onchange = function() {
    var file = this.files[0];

    var reader = new FileReader();
    reader.onload = function(progressEvent) {
        var select = document.getElementById("types");
        select.options.length = 0;
        // By lines
        var lines = this.result.split('\n');
        var count = 0;
        for(var line = 0; line < lines.length; line++) {
            console.debug("Line: " + lines[line]);
            var cols = lines[line].split(',');
            if (cols[1] == "X") {
                // New class of unit
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
                    // 9 - Modifier 
                    parseInt(cols[10], 10), // Primary Attack Count
                    // 11 - Roll
                    // 12 - Secondary Attack Damage
                    parseInt(cols[13], 10), // Str
                    parseInt(cols[14], 10), // Dex
                    parseInt(cols[15], 10), // Con
                    parseInt(cols[16], 10), // Wis
                    10, // Int
                    10, // Cha
                    parseInt(cols[15], 10), // Proficiency Bonus
                    parseInt(cols[16], 10) // Main Attack State
                );
                unitTypes[cols[0]] = newType;
                select.options[select.options.length] = new Option(newType.name, newType.name);
                console.log(newType.name);
                count++;
            }
        }
    };
    reader.readAsText(file);
};

function fillWidth() {
    var size = parseInt(document.getElementById('unitSize').value, 10);
    document.getElementById('unitWidth').value = Math.floor(Math.sqrt(size*2));
}

function deleteUnit() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    canvas.remove(selected);
}

//=====================================================================
// DRAWING
//=====================================================================

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
    var unitWidth = parseInt(document.getElementById('unitWidth').value, 10);

    var rect = new fabric.Rect({
        width: unitWidth*scale, height: unitSize/unitWidth*scale,
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
    var stats = new Unit(unitCount + " Unit", type, unitSize, unitWidth);

    fabric.Image.fromURL('./img/heavyinf.png', function(img) {
        img.set({
            scaleX: (unitWidth*scale)/img.width,
            scaleY: (unitSize/unitWidth*scale)/img.height,
            originX: "center",
            originY: "center",
        });
        var unit = new fabric.Group([rect, img]);
        unit.set({
            top: 100, left: 100,
        });
        canvas.add(unit);
        units.splice(unitCount, 0, unit);
        unit.set({
            'id': unitCount,
            'incomingLines': [],
            'faction': unit.item(0).fill,
            'stats': stats});
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
    var txt = unit.stats.num == unit.stats.losses ? "KO" : "-" + unit.stats.losses;
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
// COMBAT
//=====================================================================

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

function rollCombat() {
    for (let unit of units) {
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
                if(unit.stats.tempHpDmg > 0 || unit.stats.tempHpApldDmg > 0)
                    tallyLosses(unit);
                console.debug(unit.stats.losses);
                displayLossText(unit);

            }
        }
    }
}

function applyDirectDamage() {
    if(!canvas.getActiveObject()) {
        return;
    }
    var selected = canvas.getActiveObject();
    var amount = parseInt(document.getElementById('directDamageAmt').value, 10);
    var num = parseInt(document.getElementById('directDamageNum').value, 10);
    selected.stats.addTempDirectDamage(amount);
    console.debug("Applied damage: " + selected.stats.tempHpApldDmg);
    tallyLosses(selected, true, num);
    displayLossText(selected);
}

function stageAttacks(attacker, defender, split, advantage, roll) {
    if(roll == undefined) {
        var bonus = attacker.stats.getMainAttBonus();
        roll = Math.floor(Math.random() * 19) + 1 + bonus;
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
        console.debug("Final Roll: " + roll);
    }
    console.debug("AC: " + defender.stats.type.ac);
    var factor = Math.floor((roll - defender.stats.type.ac) / 5);
    var dmg = (attacker.stats.type.dmg * Math.min(attacker.stats.num, attacker.stats.width))/split;
    // Calculate potential damage
    console.debug("Pot Dmg: " + dmg);
    defender.stats.addTempDamage(factor >= 0 ? dmg : factor >= -1 ? dmg/2 : factor >= -2 ? dmg/4 : 0);
}

function tallyLosses(unit, direct=false, num=Infinity) {
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
    unit.stats.addLosses(losses);
    // Adjust HP for losses
    console.debug("Reduced Damage to Loss: " + (-1 * losses * unit.stats.type.hp));
    if(direct) {
        unit.stats.addTempDirectDamage(-1 * losses * unit.stats.type.hp);
    } else {
        unit.stats.addTempDamage(-1 * losses * unit.stats.type.hp);
    }
}

function applyCombat() {
    for (let unit of units) {
        applyUnitCombat(unit);
    }
    rollCombat();
    canvas.renderAll();
    if(document.getElementById('roll').checked == true) {
        round++;
        var text = document.getElementById('apply').firstChild;
        text.data = "Fight: Round " + (round+1);
    }
}

function applyUnitCombat(unit) {
    /*
    rect = unit.item(0);
    console.log("Area: " + rect.getScaledWidth()*unit.getScaledHeight());
    console.log(unit.stats.num-unit.stats.losses);///(unit.stats.width));
    console.log(Math.floor(rect.getScaledWidth()*rect.getScaledHeight()));
    console.log("Num: " + unit.stats.num-unit.stats.losses);
    unit.scaleToHeight((unit.stats.num-unit.stats.losses)/(unit.stats.width));
    */
    unit.stats.applyResults();
    var integrityRatio = unit.stats.num/unit.stats.origNum;
    var integrity =
        integrityRatio > 0.9 ? 'Fresh' :
        integrityRatio > 0.7 ? 'Taken Losses' :
        integrityRatio > 0.5 ? 'Heavy Losses' :
        integrityRatio > 0.3 ? 'Critical Losses' :
        'Decimated';
    //if(integrityRatio == 0) {
    //    canvas.remove(unit);
    //    units[unit.id] = null;
    //}
    unit.stats.integrity = integrity;
    var percentDamage = (unit.stats.tempHpDmg+unit.stats.hpDmg)/(unit.stats.type.hp*unit.stats.num);
    console.log((unit.stats.num/unit.stats.width)*scale);
    unit.item(0).set({
        //opacity: (integrityRatio)/2,
        scaleX: (unit.stats.width*scale)/unit.width,
        scaleY: ((unit.stats.num/unit.stats.width)*scale)/unit.height,
    });
    unit.item(1).set({
        opacity: (1-percentDamage),
        scaleX: (unit.stats.width*scale)/unit.item(1).width,
        scaleY: ((unit.stats.num/unit.stats.width)*scale)/unit.item(1).height,
    });
    // BOUNDING BOX DOESN'T FIT PROPERLY!
    unit.setCoords();
    if (unit.stats.num == 0) canvas.remove(unit); // DOESN"T DELETE UNIT FROM ARRAY, fucking sue me
}