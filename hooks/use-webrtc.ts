"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { ref, push, onValue, set, remove, get, off } from "firebase/database"
import { database } from "@/lib/firebase"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/components/ui/use-toast"

interface UseWebRTCProps {
  contactId: string
  callType: "voice" | "video"
  isIncoming?: boolean
  callId?: string
}

type CallStatus = "idle" | "calling" | "ringing" | "connecting" | "connected" | "ended" | "rejected"

export const useWebRTC = ({ contactId, callType, isIncoming = false, callId }: UseWebRTCProps) => {
  const { currentUser } = useAuth()
  const { toast } = useToast()

  // WebRTC states
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [callStatus, setCallStatus] = useState<CallStatus>("idle")

  // Control states
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoEnabled, setIsVideoEnabled] = useState(callType === "video")
  const [isSpeakerOn, setIsSpeakerOn] = useState(false)

  // Refs
  const callIdRef = useRef<string | null>(callId || null)
  const listenersRef = useRef<{ [key: string]: any }>({})
  const isInitializedRef = useRef(false)
  const candidatesQueueRef = useRef<RTCIceCandidateInit[]>([])

  // Enhanced WebRTC Configuration with more STUN/TURN servers
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:stun.services.mozilla.com" },
      { urls: "stun:stun.stunprotocol.org:3478" },
      { urls: "stun:stun.voiparound.com" },
      { urls: "stun:stun.voipbuster.com" },
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  }

  // Set callId when provided
  useEffect(() => {
    if (callId && callId !== callIdRef.current) {
      console.log("useWebRTC: Setting callId from props:", callId)
      console.log("useWebRTC: Previous callId was:", callIdRef.current)
      callIdRef.current = callId

      if (isIncoming) {
        isInitializedRef.current = false
      }
    }
  }, [callId, isIncoming])

  // Clean up all listeners
  const cleanupListeners = useCallback(() => {
    console.log("Cleaning up all Firebase listeners")
    Object.values(listenersRef.current).forEach((ref) => {
      if (ref) off(ref)
    })
    listenersRef.current = {}
  }, [])

  // Initialize media stream with better constraints
  const initializeMedia = useCallback(async () => {
    try {
      console.log("Initializing media for", callType)
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
          // Add more audio constraints for better quality
          googEchoCancellation: true,
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
        } as any,
        video:
          callType === "video"
            ? {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30, max: 60 },
                facingMode: "user",
              }
            : false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      console.log("Media stream obtained:", stream)
      console.log(
        "Audio tracks:",
        stream.getAudioTracks().map((t) => ({
          id: t.id,
          label: t.label,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
        })),
      )

      if (callType === "video") {
        console.log(
          "Video tracks:",
          stream.getVideoTracks().map((t) => ({
            id: t.id,
            label: t.label,
            enabled: t.enabled,
            muted: t.muted,
            readyState: t.readyState,
          })),
        )
      }

      setLocalStream(stream)
      return stream
    } catch (error) {
      console.error("Error accessing media devices:", error)
      toast({
        title: "Media Access Error",
        description: "Could not access camera/microphone. Please check permissions.",
        variant: "destructive",
      })
      throw error
    }
  }, [callType, toast])

  // Create peer connection with enhanced event handling
  const createPeerConnection = useCallback(
    (stream: MediaStream) => {
      console.log("Creating peer connection with stream")
      const pc = new RTCPeerConnection(rtcConfig)

      // Add all tracks from local stream
      stream.getTracks().forEach((track) => {
        console.log("Adding track to peer connection:", track.kind, track.label, track.enabled)
        const sender = pc.addTrack(track, stream)
        console.log("Track added, sender:", sender)
      })

      // Enhanced ICE candidate handling
      pc.onicecandidate = (event) => {
        console.log("ICE candidate event:", event)
        if (event.candidate && callIdRef.current) {
          console.log("Sending ICE candidate:", {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid,
            type: event.candidate.type,
          })

          const candidateRef = ref(database, `calls/${callIdRef.current}/candidates/${currentUser?.uid}`)
          push(candidateRef, {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid,
            usernameFragment: event.candidate.usernameFragment,
            timestamp: Date.now(),
          }).catch((error) => {
            console.error("Error sending ICE candidate:", error)
          })
        } else if (!event.candidate) {
          console.log("ICE gathering complete")
        }
      }

      // Enhanced remote stream handling
      pc.ontrack = (event) => {
        console.log("Received remote track event:", {
          track: {
            kind: event.track.kind,
            id: event.track.id,
            label: event.track.label,
            enabled: event.track.enabled,
            muted: event.track.muted,
            readyState: event.track.readyState,
          },
          streams: event.streams.map((s) => ({
            id: s.id,
            active: s.active,
            tracks: s.getTracks().length,
          })),
        })

        if (event.streams && event.streams[0]) {
          console.log(
            "Setting remote stream with tracks:",
            event.streams[0].getTracks().map((t) => ({
              kind: t.kind,
              enabled: t.enabled,
              muted: t.muted,
              readyState: t.readyState,
            })),
          )
          setRemoteStream(event.streams[0])
        }
      }

      // Enhanced connection state handling
      pc.onconnectionstatechange = () => {
        console.log("Connection state changed:", pc.connectionState)
        console.log("ICE connection state:", pc.iceConnectionState)
        console.log("ICE gathering state:", pc.iceGatheringState)
        console.log("Signaling state:", pc.signalingState)

        switch (pc.connectionState) {
          case "connected":
            console.log("✅ Peer connection established!")
            setIsConnected(true)
            setCallStatus("connected")

            // Log final connection stats
            console.log("Local description:", pc.localDescription)
            console.log("Remote description:", pc.remoteDescription)
            break
          case "connecting":
            console.log("🔄 Peer connection connecting...")
            setCallStatus("connecting")
            break
          case "disconnected":
            console.log("⚠️ Peer connection disconnected")
            setIsConnected(false)
            break
          case "failed":
            console.log("❌ Peer connection failed")
            setIsConnected(false)
            setCallStatus("ended")
            break
          case "closed":
            console.log("🔒 Peer connection closed")
            setIsConnected(false)
            break
        }
      }

      // ICE connection state handling
      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state changed:", pc.iceConnectionState)
        switch (pc.iceConnectionState) {
          case "connected":
          case "completed":
            console.log("✅ ICE connection established!")
            setIsConnected(true)
            setCallStatus("connected")
            break
          case "checking":
            console.log("🔄 ICE checking...")
            break
          case "failed":
            console.log("❌ ICE connection failed")
            setCallStatus("ended")
            break
          case "disconnected":
            console.log("⚠️ ICE disconnected")
            break
          case "closed":
            console.log("🔒 ICE closed")
            setIsConnected(false)
            break
        }
      }

      // ICE gathering state
      pc.onicegatheringstatechange = () => {
        console.log("ICE gathering state changed:", pc.iceGatheringState)
      }

      // Signaling state
      pc.onsignalingstatechange = () => {
        console.log("Signaling state changed:", pc.signalingState)
      }

      setPeerConnection(pc)
      return pc
    },
    [currentUser?.uid],
  )

  // Process queued ICE candidates
  const processQueuedCandidates = useCallback(async (pc: RTCPeerConnection) => {
    console.log("Processing queued ICE candidates:", candidatesQueueRef.current.length)
    for (const candidate of candidatesQueueRef.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
        console.log("✅ Added queued ICE candidate")
      } catch (error) {
        console.error("❌ Error adding queued ICE candidate:", error)
      }
    }
    candidatesQueueRef.current = []
  }, [])

  // Start outgoing call
  const startCall = useCallback(async () => {
    if (!currentUser || isInitializedRef.current) return

    try {
      console.log("🚀 Starting outgoing call")
      isInitializedRef.current = true
      setCallStatus("calling")

      const stream = await initializeMedia()
      const pc = createPeerConnection(stream)

      // Create call document in Firebase
      const callRef = push(ref(database, "calls"))
      callIdRef.current = callRef.key

      console.log("📞 Creating call with ID:", callRef.key)

      const callData = {
        callerId: currentUser.uid,
        calleeId: contactId,
        type: callType,
        status: "calling",
        createdAt: Date.now(),
      }

      await set(callRef, callData)

      // Create offer with enhanced options
      console.log("📝 Creating offer...")
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === "video",
        voiceActivityDetection: true,
        iceRestart: false,
      })

      console.log("📝 Offer created:", offer)
      await pc.setLocalDescription(offer)
      console.log("📝 Local description set")

      // Save offer to Firebase
      await set(ref(database, `calls/${callRef.key}/offer`), {
        type: offer.type,
        sdp: offer.sdp,
        timestamp: Date.now(),
      })
      console.log("📝 Offer saved to Firebase")

      // Listen for answer
      const answerRef = ref(database, `calls/${callRef.key}/answer`)
      listenersRef.current.answer = answerRef

      const handleAnswer = async (snapshot: any) => {
        if (snapshot.exists() && pc.currentRemoteDescription === null) {
          console.log("📨 Received answer:", snapshot.val())
          const answer = snapshot.val()
          await pc.setRemoteDescription(new RTCSessionDescription(answer))
          console.log("📨 Remote description set from answer")
          setCallStatus("connecting")
          await processQueuedCandidates(pc)
        }
      }

      onValue(answerRef, handleAnswer)

      // Listen for ICE candidates from callee
      const candidatesRef = ref(database, `calls/${callRef.key}/candidates/${contactId}`)
      listenersRef.current.candidates = candidatesRef

      const handleCandidates = (snapshot: any) => {
        if (snapshot.exists()) {
          const candidates = snapshot.val()
          console.log("🧊 Received ICE candidates from callee:", Object.keys(candidates).length)

          Object.values(candidates).forEach(async (candidateData: any) => {
            if (candidateData && candidateData.candidate) {
              try {
                if (pc.remoteDescription) {
                  console.log("🧊 Adding ICE candidate from callee:", candidateData)
                  await pc.addIceCandidate(
                    new RTCIceCandidate({
                      candidate: candidateData.candidate,
                      sdpMLineIndex: candidateData.sdpMLineIndex,
                      sdpMid: candidateData.sdpMid,
                      usernameFragment: candidateData.usernameFragment,
                    }),
                  )
                  console.log("✅ Successfully added ICE candidate")
                } else {
                  console.log("⏳ Queueing ICE candidate (no remote description yet)")
                  candidatesQueueRef.current.push(candidateData)
                }
              } catch (error) {
                console.error("❌ Error adding ICE candidate:", error)
              }
            }
          })
        }
      }

      onValue(candidatesRef, handleCandidates)

      // Listen for call status changes
      const statusRef = ref(database, `calls/${callRef.key}/status`)
      listenersRef.current.status = statusRef

      const handleStatusChange = (snapshot: any) => {
        if (snapshot.exists()) {
          const status = snapshot.val()
          console.log("📊 Call status changed to:", status)
          setCallStatus(status)

          if (status === "rejected") {
            setTimeout(() => cleanup(), 3000)
          } else if (status === "ended") {
            setTimeout(() => cleanup(), 1000)
          } else if (status === "accepted") {
            setCallStatus("connecting")
          }
        }
      }

      onValue(statusRef, handleStatusChange)
    } catch (error) {
      console.error("❌ Error starting call:", error)
      setCallStatus("ended")
      cleanup()
    }
  }, [currentUser, contactId, callType, initializeMedia, createPeerConnection, processQueuedCandidates])

  // Accept incoming call
  const acceptCall = useCallback(async () => {
    console.log("📞 acceptCall called")
    console.log("👤 Current user:", currentUser?.uid)
    console.log("🆔 Call ID:", callIdRef.current)
    console.log("🔄 Is initialized:", isInitializedRef.current)

    if (!currentUser || !callIdRef.current) {
      console.log("❌ Cannot accept call - missing requirements")
      return
    }

    if (isInitializedRef.current) {
      console.log("✅ Already initialized, call is already accepted")
      return
    }

    console.log("🚀 Accepting incoming call with ID:", callIdRef.current)
    isInitializedRef.current = true

    try {
      setCallStatus("connecting")

      // Get call data
      const callRef = ref(database, `calls/${callIdRef.current}`)
      const callSnapshot = await get(callRef)

      if (!callSnapshot.exists()) {
        console.error("❌ Call does not exist")
        setCallStatus("ended")
        return
      }

      const callData = callSnapshot.val()
      console.log("📞 Found call data:", callData)

      // Wait for offer
      const offerRef = ref(database, `calls/${callIdRef.current}/offer`)
      let offerSnapshot = await get(offerRef)
      let attempts = 0
      const maxAttempts = 10

      while (!offerSnapshot.exists() && attempts < maxAttempts) {
        console.log(`⏳ Waiting for offer, attempt ${attempts + 1}/${maxAttempts}...`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        offerSnapshot = await get(offerRef)
        attempts++
      }

      if (!offerSnapshot.exists()) {
        console.error("❌ No offer found after", maxAttempts, "attempts")
        setCallStatus("ended")
        return
      }

      const offer = offerSnapshot.val()
      console.log("📨 Found offer:", offer)

      // Initialize media and peer connection
      console.log("🎤 Initializing media...")
      const stream = await initializeMedia()
      console.log("🔗 Creating peer connection...")
      const pc = createPeerConnection(stream)

      // Set remote description from offer
      console.log("📨 Setting remote description...")
      await pc.setRemoteDescription(
        new RTCSessionDescription({
          type: offer.type,
          sdp: offer.sdp,
        }),
      )
      console.log("✅ Remote description set successfully")

      // Create answer
      console.log("📝 Creating answer...")
      const answer = await pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === "video",
        voiceActivityDetection: true,
      })

      console.log("📝 Answer created:", answer)
      await pc.setLocalDescription(answer)
      console.log("📝 Local description set")

      // Save answer to Firebase
      console.log("💾 Saving answer to Firebase...")
      await set(ref(database, `calls/${callIdRef.current}/answer`), {
        type: answer.type,
        sdp: answer.sdp,
        timestamp: Date.now(),
      })
      console.log("✅ Answer saved to Firebase")

      // Set call status to accepted
      console.log("📊 Setting call status to accepted...")
      await set(ref(database, `calls/${callIdRef.current}/status`), "accepted")
      console.log("✅ Call status set to accepted")

      // Process queued candidates
      await processQueuedCandidates(pc)

      // Listen for ICE candidates from caller
      const candidatesRef = ref(database, `calls/${callIdRef.current}/candidates/${contactId}`)
      listenersRef.current.candidates = candidatesRef

      const handleCandidates = (snapshot: any) => {
        if (snapshot.exists()) {
          const candidates = snapshot.val()
          console.log("🧊 Received ICE candidates from caller:", Object.keys(candidates).length)

          Object.values(candidates).forEach(async (candidateData: any) => {
            if (candidateData && candidateData.candidate) {
              try {
                console.log("🧊 Adding ICE candidate from caller:", candidateData)
                await pc.addIceCandidate(
                  new RTCIceCandidate({
                    candidate: candidateData.candidate,
                    sdpMLineIndex: candidateData.sdpMLineIndex,
                    sdpMid: candidateData.sdpMid,
                    usernameFragment: candidateData.usernameFragment,
                  }),
                )
                console.log("✅ Successfully added ICE candidate")
              } catch (error) {
                console.error("❌ Error adding ICE candidate:", error)
              }
            }
          })
        }
      }

      onValue(candidatesRef, handleCandidates)

      // Listen for call status changes
      const statusRef = ref(database, `calls/${callIdRef.current}/status`)
      listenersRef.current.callStatus = statusRef

      const handleStatusChange = (snapshot: any) => {
        if (snapshot.exists()) {
          const status = snapshot.val()
          console.log("📊 Call status changed to:", status)
          setCallStatus(status)

          if (status === "ended") {
            cleanup()
          }
        }
      }

      onValue(statusRef, handleStatusChange)

      console.log("🎉 Call accepted successfully - WebRTC setup complete")
    } catch (error) {
      console.error("❌ Error accepting call:", error)
      setCallStatus("ended")
      cleanup()
    }
  }, [currentUser, contactId, callType, initializeMedia, createPeerConnection, processQueuedCandidates])

  // Reject call
  const rejectCall = useCallback(async () => {
    if (!callIdRef.current) return

    console.log("❌ Rejecting call:", callIdRef.current)
    try {
      await set(ref(database, `calls/${callIdRef.current}/status`), "rejected")
      setCallStatus("rejected")
      cleanup()
    } catch (error) {
      console.error("Error rejecting call:", error)
    }
  }, [])

  // End call
  const endCall = useCallback(async () => {
    console.log("📞 Ending call:", callIdRef.current)
    if (callIdRef.current) {
      try {
        await set(ref(database, `calls/${callIdRef.current}/status`), "ended")
      } catch (error) {
        console.error("Error ending call:", error)
      }
    }
    setCallStatus("ended")
    cleanup()
  }, [])

  // Cleanup function
  const cleanup = useCallback(() => {
    console.log("🧹 Cleaning up WebRTC resources")

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        console.log("🛑 Stopping track:", track.kind, track.label)
        track.stop()
      })
      setLocalStream(null)
    }

    if (peerConnection) {
      console.log("🔒 Closing peer connection")
      peerConnection.close()
      setPeerConnection(null)
    }

    cleanupListeners()

    if (callIdRef.current && (callStatus === "ended" || callStatus === "rejected")) {
      remove(ref(database, `calls/${callIdRef.current}`))
      callIdRef.current = null
    }

    setRemoteStream(null)
    setIsConnected(false)
    isInitializedRef.current = false
    candidatesQueueRef.current = []
  }, [localStream, peerConnection, cleanupListeners, callStatus])

  // Control functions
  const toggleMute = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
        console.log("🎤 Audio track", audioTrack.enabled ? "enabled" : "disabled")
      }
    }
  }, [localStream])

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoEnabled(videoTrack.enabled)
        console.log("📹 Video track", videoTrack.enabled ? "enabled" : "disabled")
      }
    }
  }, [localStream])

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn(!isSpeakerOn)
    console.log("🔊 Speaker", !isSpeakerOn ? "on" : "off")
  }, [isSpeakerOn])

  // Auto-start call for outgoing calls
  useEffect(() => {
    if (!isIncoming && contactId && callStatus === "idle" && !isInitializedRef.current) {
      console.log("🚀 Auto-starting outgoing call")
      startCall()
    }
  }, [isIncoming, contactId, callStatus, startCall])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    localStream,
    remoteStream,
    isConnected,
    callStatus,
    isMuted,
    isVideoEnabled,
    isSpeakerOn,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    acceptCall,
    rejectCall,
    endCall,
    startCall,
  }
}
