function tokenize(str: string) {
    return str.toLowerCase().split(/\b/);
}

function preprocess(w: string[], x: string[]) {
    let words = new Map<string, number[]>();
    x.forEach((word, i) => {
        let ids = words.get(word);
        if (ids === undefined)
            words.set(word, [i]);
        else
            ids.push(i);
    });

    let a = w.map((word) => (words.get(word) ?? [-1])[0]);
    let minwords = new Map([...words].map(([word, ids]) => [word, ids[0]]));
    let synonyms = new Map([...words.values()].map((syns) => [syns[0], syns]));
    return [minwords, synonyms, a] as const;
}

function LIS(a: number[], synonyms: Map<number, number[]>) {
    const n = a.length;
    let d = new Array(n+1);
    let index = new Array(n+1);
    let prev = new Array(n+1);
    d[0] = Number.NEGATIVE_INFINITY;
    for (let i = 1; i <= n; i++)
         d[i] = Number.POSITIVE_INFINITY;

    let currentMax = 1;
    for (let i = 0; i < n; i++) {
        if (a[i] < 0) continue;
        const syns = synonyms.get(a[i])!;
        for (let j = 1; j <= currentMax; j++) {
            let usable = syns.find((x) => d[j-1] < syns && syns < d[j]);
            if (usable !== undefined) {
                prev[i] = index[j-1];
                index[j] = i;
                d[j] = usable;
                if (j+1 > currentMax)
                    currentMax = j+1;
                break;
            }
        }
    }

    for (let i = 1; i < n; i++) {
        if (d[i] == Number.POSITIVE_INFINITY) {
            i--;
            if (i == 0) return [];
            
            let seq: number[] = [];
            let idx = index[i];
            while (idx !== undefined) {
                seq.push(idx);
                idx = prev[idx];
            }
            return seq.reverse();
        }
    }
    // unreachable
    return [];
}

let text = `Ich habe noch eine Bitte, Frau Oberköchin
es ist möglich, daß mir morgen, vielleicht sehr früh, meine früheren Kameraden eine Photographie bringen, die ich dringend brauche. Wären Sie so freundlich und würden Sie dem Portier telephonieren, er möchte die Leute zu mir schicken oder mich holen lassen?
Gewiß
aber würde es nicht genügen, wenn er ihnen die Photographie abnimmt? Was ist es denn für eine Photographie, wenn man fragen darf?
Es ist die Photographie meiner Eltern
Nein, ich muß mit den Leuten selbst sprechen.
Wir können uns selbst bedienen
Eine Arbeitszeit von zehn bis zwölf Stunden ist eben ein wenig zuviel für einen solchen Jungen
Aber es ist eigentümlich in Amerika. Da ist dieser kleine Junge zum Beispiel, er ist auch erst vor einem halben Jahre mit seinen Eltern hier angekommen, er ist ein Italiener. Jetzt sieht er aus, als könne er die Arbeit unmöglich aushalten, hat schon kein Fleisch im Gesicht, schläft im Dienst ein, obwohl er von Natur sehr bereitwillig ist, – aber er muß nur noch ein halbes Jahr hier oder irgendwo anders in Amerika dienen und hält alles mit Leichtigkeit aus, und in fünf Jahren wird er ein starker Mann sein. Von solchen Beispielen könnte ich Ihnen stundenlang erzählen. Dabei denke ich gar nicht an Sie, denn Sie sind ein kräftiger Junge; Sie sind siebzehn Jahre alt, nicht?
Ich werde nächsten Monat sechzehn
Sogar erst sechzehn!
Also nur Mut!
Erschrecken Sie nicht über die Einrichtung
es ist nämlich kein Hotelzimmer, sondern ein Zimmer meiner Wohnung, die aus drei Zimmern besteht, so daß Sie mich nicht im geringsten stören. Ich sperre die Verbindungstüre ab, so daß Sie ganz ungeniert bleiben. Morgen, als neuer Hotelangestellter, werden Sie natürlich Ihr eigenes Zimmerchen bekommen. Wären Sie mit Ihren Kameraden gekommen, dann hätte ich Ihnen in der gemeinsamen Schlafkammer der Hausdiener aufbetten lassen, aber da Sie allein sind, denke ich, daß es Ihnen hier besser passen wird, wenn Sie auch nur auf einem Sofa schlafen müssen. Und nun schlafen Sie wohl, damit Sie sich für den Dienst kräftigen. Er wird morgen noch nicht zu anstrengend sein.`;

let search = 'Es ist möglich in Amerika. Da ist dieser Junge zum Beispiel';
console.log(tokenize(search))
let [w, s, a] = preprocess(tokenize(text), tokenize(search));
console.log(s);
let t0 = Date.now();
console.log(LIS(a, s));
console.log(Date.now() - t0);