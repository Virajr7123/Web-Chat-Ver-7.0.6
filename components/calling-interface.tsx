"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { useWebRTC } from "@/hooks/use-webrtc"

interface CallingInterfaceProps {
  isOpen: boolean
  onClose: () => void
  contact: {
    id: string
    name: string
    avatar?: string
  } | null
  callType: "voice" | "video"
  isIncoming?: boolean
  callId?: string
  onAccept?: () => void
  onReject?: () => void
}

export default function CallingInterface({
  isOpen,
  onClose,
  contact,
  callType,
  isIncoming = false,
  callId,
  onAccept,
  onReject,
}: CallingInterfaceProps) {
  const { currentUser, userProfile } = useAuth()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [callStartTime, setCallStartTime] = useState<number | null>(null)
  const [showControls, setShowControls] = useState(true)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const controlsTimeoutRef = useRef<NodeJS.Timeout>()

  const {
    localStream,
    remoteStream,
    isConnected,
    isMuted,
    isVideoEnabled,
    isSpeakerOn,
    callStatus,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    endCall,
    acceptCall,
    rejectCall,
  } = useWebRTC({
    contactId: contact?.id || "",
    callType,
    isIncoming,
    callId,
  })

  // Debug logging
  useEffect(() => {
    console.log("CallingInterface - Call status:", callStatus)
    console.log("CallingInterface - Is connected:", isConnected)
    console.log("CallingInterface - Call ID:", callId)
  }, [callStatus, isConnected, callId])

  // Update call duration
  useEffect(() => {
    if (isConnected && !callStartTime) {
      setCallStartTime(Date.now())
      console.log("Call connected, starting timer")
    }

    if (callStartTime && isConnected) {
      const interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTime) / 1000))
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [isConnected, callStartTime])

  // Set up local video stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log("Setting local video stream")
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.muted = true
    }
  }, [localStream])

  // Set up remote video stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      console.log("Setting remote video stream")
      remoteVideoRef.current.srcObject = remoteStream
      remoteVideoRef.current.muted = false
    }
  }, [remoteStream])

  // Set up remote audio stream for voice calls
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      console.log("Setting remote audio stream")
      remoteAudioRef.current.srcObject = remoteStream
      remoteAudioRef.current.muted = false
      remoteAudioRef.current.volume = isSpeakerOn ? 1.0 : 0.8

      remoteAudioRef.current.play().catch((error) => {
        console.error("Error playing remote audio:", error)
      })
    }
  }, [remoteStream, isSpeakerOn])

  // Auto-hide controls in video calls
  useEffect(() => {
    if (callType === "video" && isConnected && !isIncoming) {
      const resetTimeout = () => {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current)
        }
        setShowControls(true)
        controlsTimeoutRef.current = setTimeout(() => {
          setShowControls(false)
        }, 3000)
      }

      resetTimeout()
      return () => {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current)
        }
      }
    }
  }, [callType, isConnected, isIncoming])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  // SIMPLIFIED ACCEPT HANDLER - Only call acceptCall once
  const handleAccept = async () => {
    if (isAccepting) return

    console.log("BIG BOX: Accepting call in calling interface")
    setIsAccepting(true)

    try {
      // Only call acceptCall if this is truly an incoming call that hasn't been accepted yet
      if (isIncoming && callStatus !== "accepted") {
        await acceptCall()
      }

      onAccept?.()
      console.log("BIG BOX: Call accepted successfully")
    } catch (error) {
      console.error("BIG BOX: Error accepting call:", error)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleReject = () => {
    console.log("BIG BOX: Rejecting call in calling interface")
    rejectCall()
    onReject?.()
    onClose()
  }

  const handleEndCall = () => {
    console.log("Ending call in calling interface")
    endCall()
    onClose()
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  // Handle call status changes
  useEffect(() => {
    console.log("CallingInterface - Call status changed:", callStatus)

    if (callStatus === "rejected") {
      console.log("Call was rejected, showing rejection message")
      setTimeout(() => {
        onClose()
      }, 2000)
    } else if (callStatus === "ended") {
      console.log("Call ended, closing interface")
      onClose()
    } else if (callStatus === "connected") {
      console.log("Call connected successfully!")
      setIsAccepting(false)
    } else if (callStatus === "connecting") {
      console.log("Call is connecting...")
    } else if (callStatus === "accepted") {
      console.log("Call was accepted, should be connecting soon...")
      setIsAccepting(false)
    }
  }, [callStatus, onClose])

  // Monitor connection state changes
  useEffect(() => {
    console.log("CallingInterface - Connection state:", isConnected)
    if (isConnected) {
      console.log("WebRTC connection established!")
      console.log(
        "Local stream tracks:",
        localStream?.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled })),
      )
      console.log(
        "Remote stream tracks:",
        remoteStream?.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled })),
      )
    }
  }, [isConnected, localStream, remoteStream])

  if (!isOpen || !contact) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 z-[9999] bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 ${
          isMinimized ? "bottom-4 right-4 top-auto left-auto w-80 h-48 rounded-xl" : ""
        }`}
        onMouseMove={() => callType === "video" && setShowControls(true)}
      >
        {/* Hidden audio element for voice calls */}
        {callType === "voice" && <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />}

        {/* Background Animation */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute inset-0 opacity-20"
            animate={{
              background: [
                "radial-gradient(circle at 20% 50%, #8b5cf6 0%, transparent 50%)",
                "radial-gradient(circle at 80% 20%, #06b6d4 0%, transparent 50%)",
                "radial-gradient(circle at 40% 80%, #8b5cf6 0%, transparent 50%)",
              ],
            }}
            transition={{ duration: 8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          />
        </div>

        {/* Minimize/Maximize Button */}
        {!isIncoming && (
          <motion.button
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/20 backdrop-blur-sm text-white hover:bg-black/40 transition-all"
            onClick={() => setIsMinimized(!isMinimized)}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            {isMinimized ? <Maximize2 className="h-5 w-5" /> : <Minimize2 className="h-5 w-5" />}
          </motion.button>
        )}

        {/* Video Container */}
        {callType === "video" && (
          <div className="absolute inset-0">
            {/* Remote Video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />

            {/* Local Video */}
            <motion.div
              className="absolute top-4 left-4 w-32 h-24 rounded-lg overflow-hidden border-2 border-white/20 shadow-lg"
              drag
              dragConstraints={{ left: 0, right: 200, top: 0, bottom: 200 }}
              whileDrag={{ scale: 1.1 }}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
            </motion.div>
          </div>
        )}

        {/* Voice Call UI */}
        {callType === "voice" && (
          <div className="flex flex-col items-center justify-center h-full text-white relative">
            {/* Contact Avatar */}
            <motion.div
              className="relative mb-8"
              animate={{
                scale: isConnected ? [1, 1.05, 1] : [1, 1.1, 1],
              }}
              transition={{
                duration: isConnected ? 3 : 2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            >
              <div className="relative">
                <Avatar className="h-32 w-32 border-4 border-white/20 shadow-2xl">
                  <AvatarImage src={contact.avatar || "/placeholder.svg?height=128&width=128"} />
                  <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white text-2xl">
                    {contact.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                {/* Pulse Animation */}
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-white/30"
                  animate={{
                    scale: [1, 1.5, 2],
                    opacity: [0.8, 0.3, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeOut",
                  }}
                />
              </div>
            </motion.div>

            {/* Contact Name */}
            <motion.h2
              className="text-3xl font-bold mb-2 text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              {contact.name}
            </motion.h2>

            {/* Call Status */}
            <motion.p
              className="text-lg text-white/80 mb-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              {isIncoming
                ? isAccepting
                  ? "Connecting..."
                  : callStatus === "accepted"
                    ? "Connecting..."
                    : "Incoming call..."
                : isConnected
                  ? formatDuration(callDuration)
                  : callStatus === "connecting"
                    ? "Connecting..."
                    : callStatus === "accepted"
                      ? "Connecting..."
                      : callStatus === "ringing"
                        ? "Ringing..."
                        : callStatus === "rejected"
                          ? "Call was rejected"
                          : callStatus === "ended"
                            ? "Call ended"
                            : "Calling..."}
            </motion.p>

            {/* Audio Visualization */}
            {isConnected && (
              <motion.div
                className="flex items-center space-x-1 mb-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-green-400 rounded-full"
                    animate={{
                      height: [4, 20, 4],
                    }}
                    transition={{
                      duration: 0.5 + i * 0.1,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </motion.div>
            )}
          </div>
        )}

        {/* Controls */}
        <AnimatePresence>
          {(showControls || callType === "voice" || isIncoming) && (
            <motion.div
              className="absolute bottom-8 left-1/2 transform -translate-x-1/2"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              {isIncoming && callStatus !== "accepted" ? (
                /* Incoming Call Controls */
                <div className="flex items-center space-x-6">
                  <motion.button
                    className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg disabled:opacity-50"
                    onClick={handleReject}
                    disabled={isAccepting}
                    whileHover={{ scale: isAccepting ? 1 : 1.1 }}
                    whileTap={{ scale: isAccepting ? 1 : 0.9 }}
                    animate={
                      !isAccepting
                        ? {
                            boxShadow: [
                              "0 0 0 0 rgba(239, 68, 68, 0.7)",
                              "0 0 0 10px rgba(239, 68, 68, 0)",
                              "0 0 0 0 rgba(239, 68, 68, 0)",
                            ],
                          }
                        : {}
                    }
                    transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
                  >
                    <PhoneOff className="h-6 w-6" />
                  </motion.button>

                  <motion.button
                    className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleAccept}
                    disabled={isAccepting}
                    whileHover={{ scale: isAccepting ? 1 : 1.1 }}
                    whileTap={{ scale: isAccepting ? 1 : 0.9 }}
                    animate={
                      !isAccepting
                        ? {
                            boxShadow: [
                              "0 0 0 0 rgba(34, 197, 94, 0.7)",
                              "0 0 0 10px rgba(34, 197, 94, 0)",
                              "0 0 0 0 rgba(34, 197, 94, 0)",
                            ],
                          }
                        : {}
                    }
                    transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
                  >
                    {isAccepting ? (
                      <motion.div
                        className="w-6 h-6 border-2 border-white border-t-transparent rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                      />
                    ) : (
                      <Phone className="h-6 w-6" />
                    )}
                  </motion.button>
                </div>
              ) : (
                /* Active Call Controls */
                <div className="flex items-center space-x-4 bg-black/20 backdrop-blur-md rounded-full px-6 py-3">
                  {/* Mute Button */}
                  <motion.button
                    className={`p-3 rounded-full transition-all ${
                      isMuted ? "bg-red-500 hover:bg-red-600 text-white" : "bg-white/20 hover:bg-white/30 text-white"
                    }`}
                    onClick={toggleMute}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </motion.button>

                  {/* Video Button (only for video calls) */}
                  {callType === "video" && (
                    <motion.button
                      className={`p-3 rounded-full transition-all ${
                        !isVideoEnabled
                          ? "bg-red-500 hover:bg-red-600 text-white"
                          : "bg-white/20 hover:bg-white/30 text-white"
                      }`}
                      onClick={toggleVideo}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                    </motion.button>
                  )}

                  {/* Speaker Button */}
                  <motion.button
                    className={`p-3 rounded-full transition-all ${
                      isSpeakerOn
                        ? "bg-blue-500 hover:bg-blue-600 text-white"
                        : "bg-white/20 hover:bg-white/30 text-white"
                    }`}
                    onClick={toggleSpeaker}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    {isSpeakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                  </motion.button>

                  {/* Fullscreen Button (only for video calls) */}
                  {callType === "video" && (
                    <motion.button
                      className="p-3 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all"
                      onClick={toggleFullscreen}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                    </motion.button>
                  )}

                  {/* End Call Button */}
                  <motion.button
                    className="p-3 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all"
                    onClick={handleEndCall}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <PhoneOff className="h-5 w-5" />
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Connection Status Indicator */}
        {!isIncoming && (
          <motion.div
            className="absolute top-4 left-4 px-3 py-1 rounded-full text-sm font-medium"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              backgroundColor:
                callStatus === "connected"
                  ? "rgba(34, 197, 94, 0.2)"
                  : callStatus === "connecting" || callStatus === "accepted"
                    ? "rgba(251, 191, 36, 0.2)"
                    : "rgba(239, 68, 68, 0.2)",
              color:
                callStatus === "connected"
                  ? "#22c55e"
                  : callStatus === "connecting" || callStatus === "accepted"
                    ? "#fbbf24"
                    : "#ef4444",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="flex items-center space-x-2">
              <motion.div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor:
                    callStatus === "connected"
                      ? "#22c55e"
                      : callStatus === "connecting" || callStatus === "accepted"
                        ? "#fbbf24"
                        : "#ef4444",
                }}
                animate={{
                  scale: callStatus === "connecting" || callStatus === "accepted" ? [1, 1.5, 1] : 1,
                  opacity: callStatus === "connecting" || callStatus === "accepted" ? [1, 0.5, 1] : 1,
                }}
                transition={{
                  duration: 1,
                  repeat: callStatus === "connecting" || callStatus === "accepted" ? Number.POSITIVE_INFINITY : 0,
                }}
              />
              <span>
                {callStatus === "connected"
                  ? "Connected"
                  : callStatus === "connecting"
                    ? "Connecting"
                    : callStatus === "accepted"
                      ? "Connecting"
                      : callStatus === "ringing"
                        ? "Ringing"
                        : callStatus === "rejected"
                          ? "Rejected"
                          : callStatus === "ended"
                            ? "Ended"
                            : "Calling"}
              </span>
            </div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
