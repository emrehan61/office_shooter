// FXAA 3.11 — Fast Approximate Anti-Aliasing
// Based on the algorithm by Timothy Lottes (NVIDIA), public domain.

const FXAAShader = {

	name: 'FXAAShader',

	uniforms: {
		'tDiffuse': { value: null },
		'resolution': { value: null },
	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`

		precision highp float;

		uniform sampler2D tDiffuse;
		uniform vec2 resolution;
		varying vec2 vUv;

		#define FXAA_REDUCE_MIN (1.0 / 128.0)
		#define FXAA_REDUCE_MUL (1.0 / 8.0)
		#define FXAA_SPAN_MAX   8.0

		void main() {

			vec2 inverseVP = 1.0 / resolution;

			vec3 rgbNW = texture2D( tDiffuse, vUv + vec2( -1.0, -1.0 ) * inverseVP ).rgb;
			vec3 rgbNE = texture2D( tDiffuse, vUv + vec2(  1.0, -1.0 ) * inverseVP ).rgb;
			vec3 rgbSW = texture2D( tDiffuse, vUv + vec2( -1.0,  1.0 ) * inverseVP ).rgb;
			vec3 rgbSE = texture2D( tDiffuse, vUv + vec2(  1.0,  1.0 ) * inverseVP ).rgb;
			vec3 rgbM  = texture2D( tDiffuse, vUv ).rgb;

			vec3 luma = vec3( 0.299, 0.587, 0.114 );
			float lumaNW = dot( rgbNW, luma );
			float lumaNE = dot( rgbNE, luma );
			float lumaSW = dot( rgbSW, luma );
			float lumaSE = dot( rgbSE, luma );
			float lumaM  = dot( rgbM,  luma );

			float lumaMin = min( lumaM, min( min( lumaNW, lumaNE ), min( lumaSW, lumaSE ) ) );
			float lumaMax = max( lumaM, max( max( lumaNW, lumaNE ), max( lumaSW, lumaSE ) ) );

			vec2 dir;
			dir.x = -( ( lumaNW + lumaNE ) - ( lumaSW + lumaSE ) );
			dir.y =  ( ( lumaNW + lumaSW ) - ( lumaNE + lumaSE ) );

			float dirReduce = max( ( lumaNW + lumaNE + lumaSW + lumaSE ) * ( 0.25 * FXAA_REDUCE_MUL ), FXAA_REDUCE_MIN );
			float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );
			dir = min( vec2( FXAA_SPAN_MAX ), max( vec2( -FXAA_SPAN_MAX ), dir * rcpDirMin ) ) * inverseVP;

			vec3 rgbA = 0.5 * (
				texture2D( tDiffuse, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb +
				texture2D( tDiffuse, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb
			);
			vec3 rgbB = rgbA * 0.5 + 0.25 * (
				texture2D( tDiffuse, vUv + dir * -0.5 ).rgb +
				texture2D( tDiffuse, vUv + dir *  0.5 ).rgb
			);

			float lumaB = dot( rgbB, luma );

			if ( lumaB < lumaMin || lumaB > lumaMax ) {
				gl_FragColor = vec4( rgbA, 1.0 );
			} else {
				gl_FragColor = vec4( rgbB, 1.0 );
			}

		}`

};

export { FXAAShader };
