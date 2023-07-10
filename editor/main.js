const colors = ['#FECEEA', '#FEF1D2', '#A9FDD8', '#D7F8FF', '#CEC5FA'];
let nextColorIdx = 0;

const statusHolder = document.getElementById('network-status');
const peersHolder = document.getElementById('peers-holder');
const placeHolder = document.getElementById('placeholder');
const logHolder = document.getElementById('log-holder');
const textLogHolder = document.getElementById('text-log-holder');
const selectionMap = new Map();


function displayLog(doc, codemirror) {
  logHolder.innerText = doc.toJSON();

  textLogHolder.innerText = doc.getRoot().content.toTestString();
}
function displayPeers(peers, myClientID) {
  const usernames = [];
  for (const { clientID, presence } of peers) {
    usernames.push(
      clientID === myClientID ? `<b>${clientID}</b>` : clientID,
    );
  }
  peersHolder.innerHTML = JSON.stringify(usernames);
}

function replaceRangeFix(cm, text, from, to, origin) {
  const adjust = cm.listSelections().findIndex(({ anchor, head }) => {
    return (
      CodeMirror.cmpPos(anchor, head) === 0 &&
      CodeMirror.cmpPos(anchor, from) === 0
    );
  });
  cm.operation(() => {
    cm.replaceRange(text, from, to, origin);
    if (adjust > -1) {
      const range = cm.listSelections()[adjust];
      if (
        range &&
        CodeMirror.cmpPos(
          range.head,
          CodeMirror.changeEnd({ from, to, text }),
        ) === 0
      ) {
        const ranges = cm.listSelections().slice();
        ranges[adjust] = { anchor: from, head: from };
        cm.setSelections(ranges);
      }
    }
  });
}

function displayRemoteSelection(cm, change, actor) {
  let color;
  if (selectionMap.has(actor)) {
    const selection = selectionMap.get(actor);
    color = selection.color;
    selection.marker.clear();
  } else {
    color = colors[nextColorIdx];
    nextColorIdx = (nextColorIdx + 1) % colors.length;
  }

  if (change.from === change.to) {
    const pos = cm.posFromIndex(change.from);
    const cursorCoords = cm.cursorCoords(pos);
    const cursorElement = document.createElement('span');
    cursorElement.style.borderLeftWidth = '2px';
    cursorElement.style.borderLeftStyle = 'solid';
    cursorElement.style.borderLeftColor = color;
    cursorElement.style.marginLeft = cursorElement.style.marginRight =
      '-1px';
    cursorElement.style.height =
      (cursorCoords.bottom - cursorCoords.top) * 0.9 + 'px';
    cursorElement.setAttribute('data-actor-id', actor);
    cursorElement.style.zIndex = 0;

    selectionMap.set(actor, {
      color: color,
      marker: cm.setBookmark(pos, {
        widget: cursorElement,
        insertLeft: true,
      }),
    });
  } else {
    const fromPos = cm.posFromIndex(Math.min(change.from, change.to));
    const toPos = cm.posFromIndex(Math.max(change.from, change.to));

    selectionMap.set(actor, {
      color: color,
      marker: cm.markText(fromPos, toPos, {
        css: `background: ${color}`,
        insertLeft: true,
      }),
    });
  }
}


async function main(){
  try{
    console.log('hit');

    // 03. create an instance of codemirror.
    const codemirror = CodeMirror.fromTextArea(placeHolder,{
        lineNumbers: true,
    });

    // 01-1. create client with RPCAddr(envoy).
    const client = new yorkie.Client('http://localhost:8080');
    // 01-2. subscribe client event.
    client.subscribe(network.statusListener(statusHolder));
    client.subscribe((event) => {
      if (event.type === 'peers-changed') {
        displayPeers(
          client.getPeersByDocKey(doc.getKey()),
          client.getID(),
        );
      }
    });
    // 01-3. activate client
    await client.activate();

    // 02. create a document then attach it into the client.
    const doc = new yorkie.Document('codemirror');
    await client.attach(doc);

    doc.update((root) => {
      if (!root.content) {
        root.content = new yorkie.Text();
      }
    }, 'create content if not exists');

    // 02-2. subscribe document event.
    doc.subscribe((event) => {
      if (event.type === 'snapshot') {
        codemirror.setValue(doc.getRoot().content.toString());
      }
      displayLog(doc, codemirror);
    });

    doc.subscribe('$.content', (event) => {
      if (event.type === 'remote-change') {
        const { actor, operations } = event.value;
        console.log(actor,operations)
        handleOperations(operations, actor);

        const textLength = codemirror.getValue().length;
        console.log(doc.getRoot().content.length, doc.getRoot().content.toString().length, textLength != doc.getRoot().content.length, textLength)
        // if (
        //   doc.getRoot().content.length !=
        //     doc.getRoot().content.toString().length ||
        //   (textLength != doc.getRoot().content.length && textLength != 0)
        // ) {
        //   debugger;
        // }
      }
    });
    await client.sync();

    codemirror.on('beforeChange', (cm, change) => {
      if (change.origin === 'yorkie' || change.origin === 'setValue') {
        return;
      }

      const from = cm.indexFromPos(change.from);
      const to = cm.indexFromPos(change.to);
      const content = change.text.join('\n');

      doc.update((root) => {
        root.content.edit(from, to, content);
      }, `update content by ${client.getID()}`);

      console.log(`%c local: ${from}-${to}: ${content}`, 'color: green');
    });

    codemirror.on('change', (cm, change) => {
      if (change.origin === 'yorkie' || change.origin === 'setValue') {
        return;
      }
      const textLength = codemirror.getValue().length;
      // if (
      //   doc.getRoot().content.length !=
      //     doc.getRoot().content.toString().length ||
      //   (textLength != doc.getRoot().content.length && textLength != 0)
      // ) {
      //   debugger;
      // }
    });

    codemirror.on('beforeSelectionChange', (cm, change) => {
      // Fix concurrent issue.
      // NOTE: The following conditional statement ignores cursor changes
      //       that occur while applying remote changes to CodeMirror
      //       and handles only movement by keyboard and mouse.
      if (!change.origin) {
        return;
      }

      const from = cm.indexFromPos(change.ranges[0].anchor);
      const to = cm.indexFromPos(change.ranges[0].head);

      doc.update((root) => {
        root.content.select(from, to);
      }, `update selection by ${client.getID()}`);
    });
    



  //   const doc = new yorkie.Document('docs','doc-1');
  //   await client.attach(doc);
  //   await client.sync();
  //   editor.setValue(doc.getRoot().content.toString());
  //   doc.update((root) => {
  //       console.log("update",root);
  //       if(!root.content){
  //           root.content = new yorkie.Text();
  //       }
  //   });
  //   //console.log(doc.getRoot().content.text);
    
  //   // (1) CodeMirror
  //   editor.on('',(cm,change)=>{
  //       console.log("change : ", change);
  //       if (change.origin === 'yorkie' || change.origin === 'setValue') {
  //           return;
  //       }
  //       const from = editor.indexFromPos(change.from);
  //       const to = editor.indexFromPos(change.to);
  //       const content = change.text.join('\n');
  //       doc.update((root)=>{
  //           console.log(from,to);
  //           root.content.edit(from,to,content);
  //       });
  //   });

  //   // (2) Yorkie
  //   doc.subscribe((event)=> {
  //       if ( event.type==='remote-change' ){
  //           console.log('A peer has changed the Document!');
  //           const change = event.value;
  //           console.log("changecontent:",change.content);
  //           const from = editor.posFromIndex(change.from);
  //           const to = editor.posFromIndex(change.to);
  //           addChange(editor, from, to, change.content || '');
  //           editor.setValue(doc.getRoot().content.toString());
  //       }
  // });


    // 04-2. document to codemirror(applying remote).
    function handleOperations(ops, actor) {
      for (const op of ops) {
        if (op.type === 'edit') {
          const from = op.from;
          const to = op.to;
          const content = op.value.content || '';

          console.log(
            `%c remote: ${from}-${to}: ${content}`,
            'color: skyblue',
          );
          const fromIdx = codemirror.posFromIndex(from);
          const toIdx = codemirror.posFromIndex(to);
          replaceRangeFix(codemirror, content, fromIdx, toIdx, 'yorkie');
        } else if (op.type === 'select') {
          console.log('%c remote selection', 'color: skyblue');
          displayRemoteSelection(codemirror, op, actor);
        }
      }
    }
      // 05. synchronize text of document and codemirror.
      codemirror.setValue(doc.getRoot().content.toString());
      displayLog(doc, codemirror);
    } catch (e) {
      console.error(e);
    }
}
main();