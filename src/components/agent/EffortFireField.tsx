import { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

type Rgb = [number, number, number];

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];

function hslTokenToRgb(token: string, fallback: Rgb): Rgb {
  const match = token.trim().match(/(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!match) return fallback;
  const hue = ((Number(match[1]) % 360) + 360) % 360;
  const saturation = clamp(Number(match[2]) / 100);
  const lightness = clamp(Number(match[3]) / 100);
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) [red, green] = [chroma, secondary];
  else if (segment < 2) [red, green] = [secondary, chroma];
  else if (segment < 3) [green, blue] = [chroma, secondary];
  else if (segment < 4) [green, blue] = [secondary, chroma];
  else if (segment < 5) [red, blue] = [secondary, chroma];
  else [red, blue] = [chroma, secondary];

  const offset = lightness - chroma / 2;
  return [(red + offset) * 255, (green + offset) * 255, (blue + offset) * 255];
}

/*
 * WebGL fire pipeline adapted from Astraeuszhao/UI's claude-range-slider.
 * Copyright Astraeus, licensed under Apache-2.0.
 */
const VERTEX_SHADER = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`;

const FIRE_SHADER = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_elapsed;
  uniform sampler2D u_back;
  uniform vec3 u_ember, u_accent, u_hot;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 uv=v_uv;
    vec2 g=uv*vec2(72.0,6.0);
    vec2 id=floor(g);
    vec2 cf=fract(g);
    float h=hash(id);
    vec2 ap=abs(cf-0.5);
    float cell=smoothstep(0.34,0.22,max(ap.x*0.9,ap.y));
    vec3 prev=texture(u_back,uv).rgb;
    float fadeMask=smoothstep(0.0,0.45,uv.x);
    vec3 decay=prev*0.90*fadeMask;
    if(u_elapsed<0.0){ fc=vec4(decay,1.0); return; }

    float t=u_time;
    float cellDelay=h*1.2;
    float cellAge=max(u_elapsed-cellDelay,0.0);
    float ignited=step(0.001,cellAge);
    float cellSpeed=0.85+h*0.30;
    float eased=1.0-pow(1.0-clamp(cellAge/2.5,0.0,1.0),3.0);
    float distance=eased*cellSpeed*ignited;
    float cellOffset=(h-0.5)*0.05;
    float front=max(1.0-distance-cellOffset,0.02);
    float tail=max(1.0-front,0.001);
    float inZone=step(front-0.003,uv.x)*step(uv.x,1.003);
    float down=clamp(max(1.0-uv.x,0.0)/tail,0.0,1.0);
    float bright=pow(1.0-down,0.65);
    bright=max(bright,0.04*ignited)*inZone;
    bright*=1.0-smoothstep(0.94,1.05,down);
    float energyScale=mix(0.15,0.5,min(u_elapsed/1.0,1.0));
    float vertical=abs(uv.y-0.5)*2.0;
    float verticalFade=pow(max(1.0-vertical*vertical*0.45,0.0),0.75);
    float timeScale=mix(0.85,1.0,min(u_elapsed/1.5,1.0));
    float f1=sin(uv.x*30.0+t*15.0*timeScale+h*6.28);
    float f2=sin(uv.x*17.0+t*8.0*timeScale+h*3.14);
    float f3=sin(uv.x*52.0+t*25.0*timeScale+h*10.0);
    float flame=smoothstep(0.08,0.92,(f1+f2*0.5+f3*0.25)*0.35+0.5);
    float r1=sin(down*16.0-t*5.0*timeScale+h*3.0);
    float r2=sin(down*8.0-t*2.5*timeScale+h*5.0);
    float rhythm=smoothstep(-0.15,0.55,r1)*(r2*0.5+0.5);
    rhythm=pow(max(rhythm,0.0),1.2);
    float averageSpeed=distance/max(cellAge,0.001);
    float age=max(cellAge-max(1.0-uv.x,0.0)/max(averageSpeed,0.001),0.0);
    float flash=step(0.0,age)*exp(-age*3.2);
    float sparkProgress=fract(t*(0.38+h*0.15)+h*7.0);
    float sparkX=1.0-sparkProgress*tail;
    float sparkY=0.5+sin(sparkProgress*11.0+h*6.28)*0.28;
    float spark=smoothstep(0.014,0.0,abs(uv.x-sparkX))
      *smoothstep(0.18,0.0,abs(uv.y-sparkY))
      *(1.0-sparkProgress)*(1.0-sparkProgress)*energyScale;
    float energy=bright*verticalFade*(flame*0.42+rhythm*0.38)
      +flash*bright*verticalFade*0.55
      +spark*0.7*inZone;
    energy*=energyScale;
    float edgeBase=exp(-pow((uv.x-front)*18.0,2.0));
    float edgeF1=sin(uv.x*45.0+t*20.0*timeScale+h*6.28)*0.5+0.5;
    float edgeF2=sin(uv.x*28.0+t*11.0*timeScale+h*3.14)*0.5+0.5;
    float edge=edgeBase*(0.25+edgeF1*edgeF2*1.5)*1.6*energyScale;
    float leadDistance=front-uv.x;
    float leadZone=smoothstep(0.07,0.0,leadDistance)*step(0.0,leadDistance)*verticalFade;
    float h2=hash(id+vec2(99.0,33.0));
    float leadFlow=sin(leadDistance*100.0+t*20.0*timeScale+h2*6.28)*0.5+0.5;
    float leadSpark=leadZone*step(0.6,h2)*leadFlow*energyScale*0.5;
    float total=energy+edge+leadSpark;

    float temperature=1.0-down;
    vec3 color=mix(u_ember,u_accent,temperature);
    color=mix(color,u_hot,pow(temperature,4.5));
    color*=total;
    float pulse=sin(t*2.8)*0.15+1.0;
    float core=exp(-pow((uv.x-1.0)*16.0,2.0));
    color+=u_hot*core*2.2*pulse*energyScale;
    color+=u_accent*exp(-pow((uv.x-1.0)*3.5,2.0))*0.12*energyScale;
    color*=cell*fadeMask;
    fc=vec4(min(decay+color,vec3(1.5)),1.0);
  }
`;

const BLUR_SHADER = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_tex;
  uniform vec2 u_dir, u_res;
  uniform float u_ext;
  vec3 sampleColor(vec2 uv){
    vec3 color=texture(u_tex,uv).rgb;
    return u_ext>0.5&&dot(color,vec3(0.2126,0.7152,0.0722))<0.3?vec3(0.0):color;
  }
  void main(){
    vec2 offset=u_dir*1.8/u_res;
    vec3 result=sampleColor(v_uv)*0.227027;
    result+=sampleColor(v_uv+offset)*0.194595;
    result+=sampleColor(v_uv-offset)*0.194595;
    result+=sampleColor(v_uv+offset*2.0)*0.121622;
    result+=sampleColor(v_uv-offset*2.0)*0.121622;
    result+=sampleColor(v_uv+offset*3.0)*0.054054;
    result+=sampleColor(v_uv-offset*3.0)*0.054054;
    fc=vec4(result,1.0);
  }
`;

const COMPOSITE_SHADER = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_scene, u_glow;
  uniform float u_light_surface;
  void main(){
    vec3 scene=texture(u_scene,v_uv).rgb;
    vec3 glow=texture(u_glow,v_uv).rgb;
    vec3 color=1.0-exp(-(scene+glow*1.2+scene*glow*0.35)*1.15);
    float strength=max(color.r,max(color.g,color.b));
    float opacity=smoothstep(0.015,0.38,strength);
    vec3 normalizedColor=color/max(strength,0.001);
    fc=vec4(mix(color,normalizedColor,u_light_surface),opacity);
  }
`;

interface FramebufferTexture {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

function useFireRenderer(canvasRef: React.RefObject<HTMLCanvasElement>, active: boolean) {
  const stateRef = useRef({ active });
  const activatedAtRef = useRef<number | null>(active ? performance.now() : null);
  const ensureLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current.active = active;
    activatedAtRef.current = active ? performance.now() : null;
    if (active) ensureLoopRef.current?.();
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return undefined;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      gl.deleteShader(shader);
      return null;
    };

    const link = (fragmentSource: string) => {
      const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      if (!vertex || !fragment) return null;
      const program = gl.createProgram();
      if (!program) return null;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.bindAttribLocation(program, 0, 'a_pos');
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
      gl.deleteProgram(program);
      return null;
    };

    const fireProgram = link(FIRE_SHADER);
    const blurProgram = link(BLUR_SHADER);
    const compositeProgram = link(COMPOSITE_SHADER);
    if (!fireProgram || !blurProgram || !compositeProgram) return undefined;

    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      fireTime: gl.getUniformLocation(fireProgram, 'u_time'),
      fireElapsed: gl.getUniformLocation(fireProgram, 'u_elapsed'),
      fireBack: gl.getUniformLocation(fireProgram, 'u_back'),
      fireEmber: gl.getUniformLocation(fireProgram, 'u_ember'),
      fireAccent: gl.getUniformLocation(fireProgram, 'u_accent'),
      fireHot: gl.getUniformLocation(fireProgram, 'u_hot'),
      blurDirection: gl.getUniformLocation(blurProgram, 'u_dir'),
      blurResolution: gl.getUniformLocation(blurProgram, 'u_res'),
      blurExterior: gl.getUniformLocation(blurProgram, 'u_ext'),
      blurTexture: gl.getUniformLocation(blurProgram, 'u_tex'),
      compositeScene: gl.getUniformLocation(compositeProgram, 'u_scene'),
      compositeGlow: gl.getUniformLocation(compositeProgram, 'u_glow'),
      compositeLightSurface: gl.getUniformLocation(compositeProgram, 'u_light_surface'),
    };

    const createTarget = (): FramebufferTexture | null => {
      const framebuffer = gl.createFramebuffer();
      const texture = gl.createTexture();
      if (!framebuffer || !texture) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        canvas.width,
        canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { framebuffer, texture };
    };

    let fireA: FramebufferTexture | null = null;
    let fireB: FramebufferTexture | null = null;
    let blurHorizontal: FramebufferTexture | null = null;
    let blurVertical: FramebufferTexture | null = null;
    let frame = 0;
    let loopRunning = false;
    let wasActive = false;
    let idleFrames = 0;
    let resizeTimer = 0;
    let lightSurface = true;
    let palette = {
      ember: [0.16, 0.32, 0.03] as Rgb,
      accent: [0.52, 0.8, 0.09] as Rgb,
      hot: [0.95, 0.98, 0.9] as Rgb,
    };

    const updatePalette = () => {
      const styles = getComputedStyle(canvas);
      const primary = hslTokenToRgb(
        styles.getPropertyValue('--primary'),
        [132, 204, 22],
      );
      const background = hslTokenToRgb(
        styles.getPropertyValue('--background'),
        [250, 250, 250],
      );
      const backgroundLuminance = (
        background[0] * 0.2126
        + background[1] * 0.7152
        + background[2] * 0.0722
      );
      lightSurface = backgroundLuminance > 160;
      const normalize = (color: Rgb): Rgb => color.map((channel) => channel / 255) as Rgb;
      palette = {
        ember: normalize(mixRgb(
          primary,
          lightSurface ? [255, 255, 255] : [0, 0, 0],
          lightSurface ? 0.18 : 0.58,
        )),
        accent: normalize(primary),
        hot: normalize(mixRgb(primary, [255, 255, 255], 0.88)),
      };
    };

    const destroyTarget = (target: FramebufferTexture | null) => {
      if (!target) return;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    };
    const destroyTargets = () => {
      destroyTarget(fireA);
      destroyTarget(fireB);
      destroyTarget(blurHorizontal);
      destroyTarget(blurVertical);
      fireA = null;
      fireB = null;
      blurHorizontal = null;
      blurVertical = null;
    };
    const createTargets = () => {
      fireA = createTarget();
      fireB = createTarget();
      blurHorizontal = createTarget();
      blurVertical = createTarget();
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      updatePalette();
      destroyTargets();
      createTargets();
    };

    const clearFire = () => {
      for (const target of [fireA, fireB]) {
        if (!target) continue;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    };

    const render = (time: number) => {
      const activeNow = stateRef.current.active;
      if (!activeNow && !wasActive) {
        idleFrames += 1;
        if (idleFrames > 90) {
          loopRunning = false;
          return;
        }
        frame = requestAnimationFrame(render);
        return;
      }
      if (!fireA || !fireB || !blurHorizontal || !blurVertical) {
        resize();
        if (!fireA || !fireB || !blurHorizontal || !blurVertical) return;
      }
      if (activeNow && !wasActive) clearFire();
      wasActive = activeNow;
      idleFrames = 0;

      const elapsed = activeNow
        ? (performance.now() - (activatedAtRef.current ?? performance.now())) / 1_000
        : -1;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindVertexArray(vertexArray);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fireB.framebuffer);
      gl.useProgram(fireProgram);
      gl.uniform1f(uniforms.fireTime, time / 1_000);
      gl.uniform1f(uniforms.fireElapsed, elapsed);
      gl.uniform3fv(uniforms.fireEmber, palette.ember);
      gl.uniform3fv(uniforms.fireAccent, palette.accent);
      gl.uniform3fv(uniforms.fireHot, palette.hot);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fireA.texture);
      gl.uniform1i(uniforms.fireBack, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.useProgram(blurProgram);
      gl.uniform2f(uniforms.blurResolution, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurHorizontal.framebuffer);
      gl.uniform2f(uniforms.blurDirection, 1, 0);
      gl.uniform1f(uniforms.blurExterior, 1);
      gl.bindTexture(gl.TEXTURE_2D, fireB.texture);
      gl.uniform1i(uniforms.blurTexture, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, blurVertical.framebuffer);
      gl.uniform2f(uniforms.blurDirection, 0, 1);
      gl.uniform1f(uniforms.blurExterior, 0);
      gl.bindTexture(gl.TEXTURE_2D, blurHorizontal.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(compositeProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fireB.texture);
      gl.uniform1i(uniforms.compositeScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurVertical.texture);
      gl.uniform1i(uniforms.compositeGlow, 1);
      gl.uniform1f(uniforms.compositeLightSurface, lightSurface ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      [fireA, fireB] = [fireB, fireA];
      frame = requestAnimationFrame(render);
    };

    const ensureLoop = () => {
      if (document.hidden) return;
      if (loopRunning) {
        idleFrames = 0;
        return;
      }
      loopRunning = true;
      wasActive = false;
      idleFrames = 0;
      frame = requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        loopRunning = false;
        return;
      }
      if (stateRef.current.active) ensureLoop();
    };

    resize();
    ensureLoopRef.current = ensureLoop;
    if (stateRef.current.active) ensureLoop();

    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 80);
    });
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(updatePalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      ensureLoopRef.current = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      destroyTargets();
      gl.deleteProgram(fireProgram);
      gl.deleteProgram(blurProgram);
      gl.deleteProgram(compositeProgram);
      gl.deleteVertexArray(vertexArray);
      gl.deleteBuffer(vertexBuffer);
    };
  }, [canvasRef]);
}

export function EffortFireField({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useFireRenderer(canvasRef, active);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}
