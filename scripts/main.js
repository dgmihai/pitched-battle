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

var from;
var to;

// Each unit is a group
// [rect, image]
var units = new Array();
// Unordered
var collisions = new Array();
// {origin, target}
var connections = new Array();

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
    'object:rotating': onObjMove,
    'mouse:over': onOver,
    'mouse:out': onOut,
    'mouse:dblclick': onDblClick,
    'mouse:down': onDown,
    'mouse:move': onMove,
    'selection:created': onSelection,
    'selection:updated': onSelection,
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
    constructor(cr, hp, ac, attks, dmg, main, str, dex, con, wis, itl, cha, prf, morale) {
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
        this.morale = morale;
    }
}

class Unit {
    constructor(name, type, num, morale) {
        this.name = name;
        this.type = type;
        this.hpDmg = 0;
        this.tempHpDmg = 0;
        this.num = num;
        this.losses = 0;
        this.morale = morale;
    }

    addTempDamage(damage) {
        this.tempHpDmg = this.hpDmg + damage;
    }

    addLosses(losses) {
        this.losses = losses;
    }

    applyResults() {
        this.hpDmg = this.hpDmg + this.tempHpDmg;
        this.num = this.num - this.losses;
        this.losses = 0;
        this.temphpDmg = hpDmg;
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

//TEMP
var swordz = new UnitType(2, 40, 17, 2, 15, Stat.STR,
                          3, 2, 2, 1, 2, 0,
                          2, 2);

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
    if (y === null) {
        // Finding whatever child is connected to
        for (var i = 0; i < connections.length; i++) {
            if (connections[i][0] == x) {
                return i;
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
                console.log("old: " + oldTarget.id);
                console.log(getCollisions(oldTarget.id).length);
                console.log(getConnections(null, oldTarget.id).length);
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
            console.log("What's going on here");
            connections.push([line.parent.id, o.target.id]);
            console.log(connections);
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
            var textInfo = o.target.stats.name + "\n " + o.target.stats.num + " Troops";
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
    if (hoverText != null && hoverText != undefined)
        hoverText.bringToFront();
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
    var width = 80;
    var height = 40;

    var rect = new fabric.Rect({
        width: 80, height: 40,
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

    var stats = new Unit(unitCount + " Infantry", swordz, 20, 0);

    fabric.Image.fromURL('./img/heavyinf.png', function(img) {
        img.scaleToWidth(81);
        img.set({
            originX: "center",
            originY: "center"});
        var unit = new fabric.Group([rect, img]);
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

//=====================================================================
// COMBAT
//=====================================================================

function rollCombat() {
    for (let unit of units) {
        canvas.remove(unit.lossText);
        unit.lossText = null;
        var combats = [];
        var melee = getCollisions(unit.id);
        var ranged = getConnections(null, unit.id);
        console.log(ranged);
        for (let x in melee)
            combats.push(collisions[x]);
        for (let y in ranged)
            combats.push(connections[y]);
        if (combats.length > 0) {
            for (let combat of combats) {
                var attacker = [0] == unit.id ? units[combat[0]] : units[combat[1]];
                stageAttacks(attacker, unit, combats.length);
            }
            unit.setCoords();
            var coord = unit.getCenterPoint();
            console.debug(unit.stats.losses);
            unit.lossText = new fabric.Text("-" + unit.stats.losses, {
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
    }
}

function stageAttacks(attacker, defender, split, advantage, roll) {
    if(roll == undefined) {
        var bonus = attacker.stats.getMainAttBonus();
        roll = Math.floor(Math.random() * 19) + 1 + bonus;
        if (advantage) {
            roll = max(roll, Math.floor(Math.random() * 19) + 1 + bonus);
        }
    }
    console.debug("Roll: " + roll);
    console.debug("AC: " + defender.stats.type.ac);
    var factor = Math.floor((roll - defender.stats.type.ac) / 5);
    var dmg = attacker.stats.type.dmg * attacker.stats.num; // TODO: Number engaged
    // Calculate potential damage
    console.debug("Pot Dmg: " + dmg);
    defender.stats.addTempDamage(factor >= 0 ? dmg : factor >= -1 ? dmg/2 : factor >= -2 ? dmg/4 : 0);
    console.debug("Damage: " + defender.stats.tempHpDmg);
    // Calculate losses
    var losses = Math.floor(Math.random() * Math.floor(defender.stats.tempHpDmg/defender.stats.type.hp));
    var percentHealth = defender.stats.tempHpDmg/(defender.stats.type.hp*defender.stats.num);
    if (percentHealth > 0.5) {
        // Vulnerable
        losses = max(losses, Math.floor(Math.random() * Math.floor(defender.stats.tempHpDmg/defender.stats.type.hp)));
        if (percentHealth > 0.75) {
            // Weak
            losses = losses * 2;
            if (percentHealth > 1.5) {
                // Wipeout
                losses = defender.stats.num;
            }
        }
    }
    console.debug("Losses: " + losses);
    defender.stats.addLosses(losses);
    // Adjust HP for losses
    defender.stats.addTempDamage(-1 * losses * defender.stats.type.hp);
}

function applyCombat() {

}