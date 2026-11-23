export type BoosterKind = "regular" | "decision" | "sunset" | "blackout";

export const BLACKOUT_BOOSTER_IMAGE = "/assets/chrome-regular-booster-v1.png";

export const SUNSET_BOOSTER_IMAGE = "/assets/events/gta-sunset/booster.png";

// Preserve the supplied artwork; adapt startup and composite-only playback.
export function boosterOpeningDocument(
  source: string,
  parentOrigin: string,
  kind: BoosterKind,
  waitForClick = false
) {
  if (
    kind !== "regular" &&
    kind !== "decision" &&
    kind !== "sunset" &&
    kind !== "blackout"
  )
    throw new Error("Invalid pack kind");
  const origin = new URL(parentOrigin);
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    )
  ) {
    throw new Error("Invalid origin");
  }
  const json = (value: unknown) =>
    JSON.stringify(value).replace(
      /[<>&\u2028\u2029]/g,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
  const sunset = kind === "sunset";
  const blackout = kind === "blackout";
  const booster = {
    boosterImage: new URL(
      sunset
        ? SUNSET_BOOSTER_IMAGE
        : blackout
          ? BLACKOUT_BOOSTER_IMAGE
          : `/assets/chrome-${kind}-booster-v1.png`,
      origin
    ).href,
    tearAt: 17.3,
    accentColor: sunset
      ? "#ffa5d2"
      : blackout
        ? "#b5a7f2"
        : kind === "decision"
          ? "#ff69be"
          : "#8dbdff"
  };
  const nebula = sunset
    ? "/assets/events/gta-sunset/opening-nebula.webp"
    : blackout
      ? "/assets/events/blackout/opening-nebula.webp"
      : `/assets/${kind}-opening-nebula.webp`;
  if (
    !source.includes('data-yokkai-opening="tear-and-fan"') ||
    !source.includes("window.setYokkaiBooster = setYokkaiBooster;")
  )
    throw new Error("Invalid booster asset");
  let document = source.replaceAll(
    "__CARD_BACK__",
    new URL("/assets/bubble-card-back-v1.png", origin).href
  );
  if (sunset || blackout) {
    const fan =
      /<div class="opening-cards">(?:\s*<div class="opening-card"[^>]*><\/div>){5}<\/div>/;
    if (!fan.test(document)) throw new Error("Invalid booster fan");
    const cards = [-1, 0, 1].map(
      (index, order) =>
        `<div class="opening-card" style="--order:${order};--index:${index};--distance:${Math.abs(index)}"></div>`
    );
    document = document.replace(
      fan,
      `<div class="opening-cards">${cards.join("")}</div>`
    );
  }
  document = document
    .replace('<html lang="fr">', '<html lang="en" class="yokkai-wait-booster">')
    .replace(/<title>[^<]*<\/title>/, "<title>Yokkai booster opening</title>");
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*; connect-src 'none'; base-uri 'none'; form-action 'none'";
  const bridge = `<script>
    // Keep paint-heavy artwork static; animate only composited properties.
    const optimizeRules=rules=>{
      for(const rule of rules){
        if(rule.type===CSSRule.KEYFRAMES_RULE){
          for(const frame of rule.cssRules){
            for(const property of Array.from(frame.style)){
              if(property!=="transform"&&property!=="opacity")frame.style.removeProperty(property);
            }
          }
        }else if(rule.cssRules)optimizeRules(rule.cssRules);
        rule.style?.removeProperty("will-change");
      }
    };
    for(const sheet of document.styleSheets)optimizeRules(sheet.cssRules);
    const hostOrigin=${json(origin.origin)};
    const booster=${json(booster)};
    const waitForClick=${json(waitForClick)};
    let hostState='loading';
    let openRequested=!waitForClick;
    const CUT_START_MS=680;
    const OPENING_END_MS=2940;
    const CUT_SPEED_MULTIPLIER=3;
    let reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let stage='waiting';
    let pendingSkips=0;
    let completionTimer;
    let startedAt=0;
    let timelineOffset=0;
    let pointerFrame=0, pointerTime=0, pointerNow=[0,0,0,0], pointerTarget=[0,0,0,0];
    let lastHover=-Infinity;
    const paintPointer=()=>{
      const fan=stage==='complete';
      const element=document.querySelector?.(fan?'.opening-cards':'.pack-position');
      if(element)element.style.transform=(fan?'translate(-50%,-50%) ':'')+
        'translate3d('+pointerNow[0]+'px,'+pointerNow[1]+'px,0) rotateX('+pointerNow[2]+'deg) rotateY('+pointerNow[3]+'deg)';
    };
    const tickPointer=now=>{
      const blend=1-Math.exp(-Math.min(now-pointerTime,50)/100);pointerTime=now;
      pointerNow=pointerNow.map((value,index)=>value+(pointerTarget[index]-value)*blend);
      paintPointer();
      if(pointerNow.some((value,index)=>Math.abs(value-pointerTarget[index])>.003))pointerFrame=requestAnimationFrame(tickPointer);
      else pointerFrame=0;
    };
    const resetPointer=()=>{
      if(pointerFrame)cancelAnimationFrame(pointerFrame);pointerFrame=0;
      pointerNow=[0,0,0,0];pointerTarget=[...pointerNow];paintPointer();
    };
    const movePointer=point=>{
      if(reduced||!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)return;
      if(stage!=='waiting'&&stage!=='complete')return;
      const element=document.querySelector?.(stage==='complete'?'.opening-cards':'.pack-position');
      if(!element)return;
      const rect=element.getBoundingClientRect();
      const fan=stage==='complete',margin=fan?96:90;
      const x=point?(point.x-rect.left-rect.width/2)/(rect.width/2+margin):0;
      const y=point?(point.y-rect.top-rect.height/2)/(rect.height/2+70):0;
      const inside=point&&Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=1&&Math.abs(y)<=1;
      pointerTarget=inside?(fan?[x*6,y*3,-y*5,x*7]:[x*10,y*7,-y*12,x*18]):[0,0,0,0];
      if(fan&&inside&&performance.now()-lastHover>95){lastHover=performance.now();notify('YOKKAI_BOOSTER_HOVER');}
      if(!pointerFrame){pointerTime=performance.now();pointerFrame=requestAnimationFrame(tickPointer);}
    };
    const notify=type=>parent.postMessage({type},hostOrigin);
    const complete=()=>{
      if(stage==='complete'||stage==='revealed'||stage==='disposed')return;
      stage='complete';clearTimeout(completionTimer);notify('YOKKAI_BOOSTER_COMPLETE');
    };
    const advance=()=>{
      if(stage==='complete'){resetPointer();stage='revealed';notify('YOKKAI_BOOSTER_REVEAL');return;}
      if(reduced||stage==='revealed'||stage==='disposed'||stage==='accelerated')return;
      if(stage==='settling'){complete();return;}
      if(stage==='waiting'){
        if(openRequested)pendingSkips=Math.min(2,pendingSkips+1);
        return;
      }
      const elapsed=performance.now()-startedAt+timelineOffset;
      clearTimeout(completionTimer);
      if(stage==='intro'&&elapsed<CUT_START_MS){
        stage='cutting';
        // Finish the intro on the existing timeline; never mount or replay a layer.
        for(const animation of document.getAnimations()){
          if(animation.currentTime!==null)animation.currentTime=CUT_START_MS;
        }
        timelineOffset=CUT_START_MS;
        startedAt=performance.now();
        completionTimer=setTimeout(complete,OPENING_END_MS-CUT_START_MS);
      }else{
        stage='accelerated';
        for(const animation of document.getAnimations())animation.playbackRate=CUT_SPEED_MULTIPLIER;
        completionTimer=setTimeout(complete,Math.max(0,OPENING_END_MS-elapsed)/CUT_SPEED_MULTIPLIER);
      }
    };
    const beginOpening=()=>{
      if(stage!=='waiting'||!openRequested||hostState!=='YOKKAI_BOOSTER_READY')return;
      resetPointer();stage='intro';notify('YOKKAI_BOOSTER_STARTED');
      startedAt=performance.now();
      if(waitForClick){
        document.documentElement.classList.remove('yokkai-await-click');
        window.replayYokkaiBooster();
      }
      // No completion clock runs while the closed pack waits for a gesture.
      completionTimer=setTimeout(complete,reduced?500:OPENING_END_MS);
      while(pendingSkips>0){pendingSkips--;advance();}
    };
    const receive=event=>{
      if(event.source!==parent||event.origin!==hostOrigin)return;
      if(event.data?.type==='yokkai-booster-status'&&hostState!=='loading')notify(hostState);
      if(waitForClick&&event.data?.type==='yokkai-booster-open'){
        openRequested=true;beginOpening();
      }
      if(event.data?.type==='yokkai-booster-next-step')advance();
      if(event.data?.type==='yokkai-booster-pointer')movePointer(event.data.point);
    };
    window.addEventListener('message',receive);
    window.addEventListener('blur',resetPointer);
    const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motionChanged=()=>{reduced=motion.matches;resetPointer();};
    motion?.addEventListener?.('change',motionChanged);
    const onAnimationStart=event=>{
      if(event.animationName==='foil-peel'&&stage!=='disposed'&&stage!=='complete'){
        if(stage==='intro')stage='cutting';
        notify('YOKKAI_BOOSTER_TEAR');
      }
    };
    document.addEventListener('animationstart',onAnimationStart);
    const onAnimationEnd=event=>{
      if(event.animationName==='foil-body-open'&&(stage==='cutting'||stage==='accelerated'))stage='settling';
    };
    document.addEventListener('animationend',onAnimationEnd);
    window.addEventListener('pagehide',()=>{
      resetPointer();stage='disposed';pendingSkips=0;
      window.removeEventListener('blur',resetPointer);
      motion?.removeEventListener?.('change',motionChanged);
      clearTimeout(completionTimer);
      window.removeEventListener('message',receive);
      document.removeEventListener('animationstart',onAnimationStart);
      document.removeEventListener('animationend',onAnimationEnd);
      document.getAnimations().forEach(animation=>animation.cancel());
    },{once:true});
    async function startBooster(){
      try{
        const loaded=await window.setYokkaiBooster(booster);
        if(stage==='disposed')return;
        if(!loaded)throw new Error('Booster unavailable');
        document.documentElement.classList.remove('yokkai-wait-booster');
        hostState='YOKKAI_BOOSTER_READY';notify(hostState);
        // The fan settles before the 2.94s completion.
        beginOpening();
      }catch{if(stage!=='disposed'){hostState='YOKKAI_BOOSTER_ERROR';notify(hostState);}}
    }
    if(waitForClick)document.documentElement.classList.add('yokkai-await-click');
    void startBooster();
  </script>`;
  return document
    .replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`
    )
    .replace(
      "</head>",
      `<style>
      body{background:#070b13 url(${json(new URL(nebula, origin).href)}) center / cover no-repeat}
      ${blackout ? ".pack-position{filter:hue-rotate(34deg) saturate(.82) brightness(1.06)}" : ""}
      html,body,.scene{-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
      .pack-position,.opening-cards{transform-style:preserve-3d}
      .yokkai-wait-booster .scene{visibility:hidden}
      .yokkai-wait-booster *, .yokkai-wait-booster *::before, .yokkai-wait-booster *::after{animation-play-state:paused!important}
      .scene:not(.running) *, .scene:not(.running) *::before, .scene:not(.running) *::after{animation-name:none!important}
      .yokkai-await-click .scene *, .yokkai-await-click .scene.running *, .yokkai-await-click .scene *::before, .yokkai-await-click .scene *::after{animation:none!important}
      .yokkai-await-click .stage,.yokkai-await-click .ambient{opacity:1!important}
      .yokkai-await-click .pack-entrance{opacity:1!important;transform:none!important}
      .yokkai-await-click .foil-body{transform:none!important}
      .yokkai-await-click .foil-lid{display:block!important;opacity:1!important;transform:none!important}
      .yokkai-await-click .foil-edge{opacity:0!important}
      @media(prefers-reduced-motion:no-preference){
        .yokkai-await-click .scene.running .pack-float{animation:booster-float 5s ease-in-out infinite!important}
        .yokkai-await-click .scene.running .pack-sheen{animation:booster-sheen 6s infinite!important;opacity:.24}
      }
    </style></head>`
    )
    .replace("</body>", `${bridge}</body>`);
}
