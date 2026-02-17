"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import * as THREE from "three";

type DottedSurfaceProps = Omit<React.ComponentProps<"div">, "ref">;

export function DottedSurface({ className, ...props }: DottedSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    particles: THREE.Points[];
    animationId: number;
    count: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const SEPARATION = 150;
    const AMOUNTX = 40;
    const AMOUNTY = 60;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 2000, 10000);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      10000,
    );
    camera.position.set(0, 355, 1220);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(scene.fog.color, 0);

    container.appendChild(renderer.domElement);

    const positions: number[] = [];
    const colors: number[] = [];
    const geometry = new THREE.BufferGeometry();

    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
        const y = 0;
        const z = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;

        positions.push(x, y, z);
        colors.push(200, 200, 200);
      }
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const TARGET_OPACITY = 0.8;
    const FADE_DURATION = 1500;

    const material = new THREE.PointsMaterial({
      size: 8,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let count = 0;
    let animationId = 0;
    let startTime = 0;

    const animate = (time: number) => {
      animationId = requestAnimationFrame(animate);

      if (startTime === 0) startTime = time;
      const elapsed = time - startTime;

      // Smooth ease-out fade: fast start, gentle settle
      const rawProgress = Math.min(elapsed / FADE_DURATION, 1);
      const fadeProgress = 1 - Math.pow(1 - rawProgress, 3);

      material.opacity = fadeProgress * TARGET_OPACITY;

      const positionAttribute = geometry.attributes.position;
      const posArray = positionAttribute.array as Float32Array;

      let i = 0;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
          const index = i * 3;
          posArray[index + 1] =
            (Math.sin((ix + count) * 0.3) * 50 +
              Math.sin((iy + count) * 0.5) * 50) *
            fadeProgress;
          i++;
        }
      }

      positionAttribute.needsUpdate = true;
      renderer.render(scene, camera);
      count += 0.1;
    };

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);
    animationId = requestAnimationFrame(animate);

    sceneRef.current = {
      scene,
      camera,
      renderer,
      particles: [points],
      animationId,
      count,
    };

    return () => {
      window.removeEventListener("resize", handleResize);

      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);

        sceneRef.current.scene.traverse((object) => {
          if (object instanceof THREE.Points) {
            object.geometry.dispose();
            if (Array.isArray(object.material)) {
              object.material.forEach((mat) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        });

        sceneRef.current.renderer.dispose();

        if (container && sceneRef.current.renderer.domElement) {
          container.removeChild(sceneRef.current.renderer.domElement);
        }
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("pointer-events-none fixed inset-0 -z-10", className)}
      {...props}
    />
  );
}
