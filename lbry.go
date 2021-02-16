package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"

	"github.com/irmf/reflector.go/wallet"
)

var (
	// SPV wallet servers
	lbryServers = []string{
		"spv11.lbry.com:50001",
		"spv12.lbry.com:50001",
		"spv13.lbry.com:50001",
		"spv14.lbry.com:50001",
		"spv15.lbry.com:50001",
		"spv16.lbry.com:50001",
		"spv17.lbry.com:50001",
		"spv18.lbry.com:50001",
		"spv19.lbry.com:50001",
	}
	// Known nodes for bootstrapping connection to the DHT
	knownDHTNodes = []string{
		"lbrynet1.lbry.com:4444", // US EAST
		"lbrynet2.lbry.com:4444", // US WEST
		"lbrynet3.lbry.com:4444", // EU
		"lbrynet4.lbry.com:4444", // ASIA
	}
)

func loadLbrySource(url string) []byte {
	node := wallet.NewNode()
	if err := node.Connect(lbryServers, nil); err != nil {
		log.Printf("node.Connect: %v", err)
		return nil
	}
	defer node.Shutdown()

	output, err := node.Resolve(url)
	if err != nil {
		log.Printf("node.Resolve(%q): %v", url, err)
		return nil
	}

	claim, err := node.GetClaimInTx(hex.EncodeToString(rev(output.GetTxHash())), int(output.GetNout()))
	if err != nil {
		log.Printf("node.GetClaimInTx: %v", err)
		return nil
	}

	jsonClaim, err := json.MarshalIndent(claim, "", "  ")
	if err != nil {
		log.Printf("json.MarshalIndent: %v", err)
		return nil
	}

	fmt.Printf("%s\n", jsonClaim)
	return nil
}

func rev(b []byte) []byte {
	r := make([]byte, len(b))
	for left, right := 0, len(b)-1; left < right; left, right = left+1, right-1 {
		r[left], r[right] = b[right], b[left]
	}
	return r
}
