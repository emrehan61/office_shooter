import { Matrix4, ShaderMaterial, UniformsUtils, Vector2 } from 'three';
import { Pass, FullScreenQuad } from './Pass.js';

const SSRShader = {
    uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraProjectionMatrix: { value: new Matrix4() },
        cameraInverseProjectionMatrix: { value: new Matrix4() },
        resolution: { value: new Vector2() },
        maxDistance: { value: 5.0 },
        opacity: { value: 0.4 },
        thickness: { value: 0.015 },
    },

    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,

    fragmentShader: /* glsl */`
        precision highp float;

        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform mat4 cameraProjectionMatrix;
        uniform mat4 cameraInverseProjectionMatrix;
        uniform vec2 resolution;
        uniform float maxDistance;
        uniform float opacity;
        uniform float thickness;

        varying vec2 vUv;

        vec3 viewPosFromDepth(vec2 uv, float depth) {
            vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec4 view = cameraInverseProjectionMatrix * ndc;
            return view.xyz / view.w;
        }

        void main() {
            vec4 sceneColor = texture2D(tDiffuse, vUv);
            float depth = texture2D(tDepth, vUv).r;

            // Skip sky / far plane
            if (depth >= 0.9999) {
                gl_FragColor = sceneColor;
                return;
            }

            // Skip edge pixels where depth changes abruptly (prevents artifacts)
            float depthDdx = dFdx(depth);
            float depthDdy = dFdy(depth);
            if (abs(depthDdx) + abs(depthDdy) > 0.005) {
                gl_FragColor = sceneColor;
                return;
            }

            vec3 viewPos = viewPosFromDepth(vUv, depth);

            // Reconstruct normal from view-space position derivatives
            vec3 normal = normalize(cross(dFdx(viewPos), dFdy(viewPos)));
            // Ensure normal faces camera (camera at origin, viewDir points into -Z)
            vec3 viewDir = normalize(viewPos);
            if (dot(normal, viewDir) > 0.0) normal = -normal;

            // Fresnel (Schlick) — reflections stronger at grazing angles
            float NdotV = max(dot(-viewDir, normal), 0.0);
            float fresnel = pow(1.0 - NdotV, 4.0) * opacity;

            if (fresnel < 0.005) {
                gl_FragColor = sceneColor;
                return;
            }

            // Reflect view direction around surface normal
            vec3 reflDir = reflect(viewDir, normal);

            // Ray march: step along reflected ray, project to screen, compare depths
            const int STEPS = 16;
            float stepLen = maxDistance / float(STEPS);

            vec3 reflColor = vec3(0.0);
            float hitStrength = 0.0;

            for (int i = 1; i <= STEPS; i++) {
                vec3 rayPos = viewPos + reflDir * stepLen * float(i);

                // Project ray position to screen UV + depth
                vec4 clip = cameraProjectionMatrix * vec4(rayPos, 1.0);
                if (clip.w <= 0.0) break; // behind camera
                vec2 rayUV = (clip.xy / clip.w) * 0.5 + 0.5;

                // Out of screen
                if (rayUV.x < 0.0 || rayUV.x > 1.0 || rayUV.y < 0.0 || rayUV.y > 1.0) break;

                float rayProjectedDepth = clip.z / clip.w * 0.5 + 0.5;
                float surfaceDepth = texture2D(tDepth, rayUV).r;

                // Hit: ray's projected depth is behind the surface but within thickness
                float diff = rayProjectedDepth - surfaceDepth;

                if (diff > 0.0 && diff < thickness) {
                    reflColor = texture2D(tDiffuse, rayUV).rgb;

                    // Fade at screen edges
                    vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.06), rayUV) *
                                   (1.0 - smoothstep(vec2(0.94), vec2(1.0), rayUV));
                    hitStrength = edgeFade.x * edgeFade.y;

                    // Fade with march distance
                    hitStrength *= 1.0 - float(i) / float(STEPS);
                    break;
                }
            }

            gl_FragColor = vec4(mix(sceneColor.rgb, reflColor, fresnel * hitStrength), sceneColor.a);
        }`
};

/**
 * Screen-space reflections pass. Uses depth buffer ray marching with
 * Fresnel-based blending (stronger at grazing angles).
 *
 * Requires the EffectComposer's render targets to have a depthTexture.
 */
class SSRPass extends Pass {

    constructor(camera, width, height) {
        super();
        this.camera = camera;

        this.uniforms = UniformsUtils.clone(SSRShader.uniforms);
        this.uniforms.resolution.value = new Vector2(width, height);

        this.material = new ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: SSRShader.vertexShader,
            fragmentShader: SSRShader.fragmentShader,
        });

        this._fsQuad = new FullScreenQuad(this.material);
    }

    render(renderer, writeBuffer, readBuffer) {
        // Bind scene color + depth from the current read buffer
        this.uniforms.tDiffuse.value = readBuffer.texture;
        this.uniforms.tDepth.value = readBuffer.depthTexture;

        // Update camera matrices (they change with FOV / aspect)
        this.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
        this.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);

        if (this.renderToScreen) {
            renderer.setRenderTarget(null);
        } else {
            renderer.setRenderTarget(writeBuffer);
            if (this.clear) renderer.clear();
        }

        this._fsQuad.render(renderer);
    }

    setSize(width, height) {
        this.uniforms.resolution.value.set(width, height);
    }

    dispose() {
        this.material.dispose();
        this._fsQuad.dispose();
    }
}

export { SSRPass };
